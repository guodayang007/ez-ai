package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

// The product fulfiller is a separate service that buys an order's upstream
// subscription with the DogPay card (services/dogpay-fulfiller). Its settings,
// card included, are stored here encrypted with CONFIG_ENCRYPTION_KEY and
// sent with each job. Requests in both directions are signed with
// HMAC-SHA256 over "<unix seconds>.<raw body>" using the shared secret, and a
// job body is additionally encrypted with a key derived from that secret.
const (
	ProductFulfillerTimestampHeader = "X-Fulfiller-Timestamp"
	ProductFulfillerSignatureHeader = "X-Fulfiller-Signature"
	productFulfillerMaxClockSkew    = 5 * time.Minute
	productFulfillerRequestTimeout  = 15 * time.Second
	// ProductFulfillerSecretMinLength is the shortest shared secret accepted.
	ProductFulfillerSecretMinLength = 32
	// productFulfillerPayloadPurpose binds the job encryption key to its use;
	// services/dogpay-fulfiller/src/sealed.mjs derives the same key.
	productFulfillerPayloadPurpose = "ez-ai-fulfiller-payload-v1"
)

var (
	ErrProductFulfillerNotConfigured = errors.New("product fulfiller is not configured")
	// ErrProductFulfillerUnreachable means nothing answered at the configured
	// URL, usually because the service is not running.
	ErrProductFulfillerUnreachable = errors.New("product fulfiller is unreachable")
	// ErrProductFulfillerUnauthorized means the fulfiller refused the
	// signature: the shared secrets differ or the clocks are too far apart.
	ErrProductFulfillerUnauthorized = errors.New("product fulfiller rejected the signature")
)

// Providers the fulfiller can buy a subscription from. The order's input
// fields decide which one runs: a ChatGPT session or a Claude cookie.
const (
	ProductFulfillmentProviderChatGPT = "chatgpt"
	ProductFulfillmentProviderClaude  = "claude"
)

// ProductFulfillerClaudePlans are the Claude plans the fulfiller knows how to
// buy (services/dogpay-fulfiller/src/claude.mjs). Unlike ChatGPT plan codes
// they are fixed by the fulfiller, so they are not part of the settings.
var ProductFulfillerClaudePlans = []string{"claude_pro", "claude_max_5x", "claude_max_20x"}

var (
	productFulfillerPlanPattern     = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)
	productFulfillerCountryPattern  = regexp.MustCompile(`^[A-Z]{2}$`)
	productFulfillerCurrencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)
)

type ProductFulfillerCard struct {
	Number string `json:"number"`
	Expiry string `json:"expiry"`
	CVC    string `json:"cvc"`
	Holder string `json:"holder"`
}

type ProductFulfillerBilling struct {
	Country    string `json:"country"`
	Currency   string `json:"currency"`
	Line1      string `json:"line1"`
	City       string `json:"city"`
	State      string `json:"state"`
	PostalCode string `json:"postal_code"`
}

// ProductFulfillerProxy routes the purchase browser windows through a proxy
// whose exit is in the billing country. An empty Type connects directly.
type ProductFulfillerProxy struct {
	Type     string `json:"type"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// productFulfillerProxyTypes are the proxy types BitBrowser accepts for a window.
var productFulfillerProxyTypes = []string{"http", "https", "socks5", "ssh"}

// ProductFulfillerConfig is everything the fulfiller needs: where it runs,
// the shared secret, the plans it may buy, the billing address and the proxy.
// The cards it pays with come from the card pool (PaymentCard), one per job.
type ProductFulfillerConfig struct {
	URL         string                  `json:"url"`
	Secret      string                  `json:"secret"`
	CallbackURL string                  `json:"callback_url"`
	Plans       []string                `json:"plans"`
	Billing     ProductFulfillerBilling `json:"billing"`
	Proxy       ProductFulfillerProxy   `json:"proxy"`
}

// LoadProductFulfillerConfig decrypts the saved settings. Nothing saved yet
// is an empty config, not an error.
func LoadProductFulfillerConfig() (ProductFulfillerConfig, error) {
	var config ProductFulfillerConfig
	stored := system_setting.ProductFulfillerConfig
	if stored == "" {
		return config, nil
	}
	plaintext, err := common.DecryptConfigValue(stored)
	if err != nil {
		return config, err
	}
	if err := common.Unmarshal(plaintext, &config); err != nil {
		return ProductFulfillerConfig{}, common.ErrConfigDecryptFailed
	}
	return config, nil
}

// SaveProductFulfillerConfig encrypts and stores the settings.
func SaveProductFulfillerConfig(config ProductFulfillerConfig) error {
	plaintext, err := common.Marshal(config)
	if err != nil {
		return err
	}
	sealed, err := common.EncryptConfigValue(plaintext)
	if err != nil {
		return err
	}
	return model.UpdateOption(system_setting.ProductFulfillerConfigOption, sealed)
}

// Normalize trims the settings and puts them in canonical form: URLs without
// a trailing slash, upper-case codes, unique plans.
func (c *ProductFulfillerConfig) Normalize() {
	c.URL = strings.TrimRight(strings.TrimSpace(c.URL), "/")
	c.Secret = strings.TrimSpace(c.Secret)
	c.CallbackURL = strings.TrimSpace(c.CallbackURL)
	plans := make([]string, 0, len(c.Plans))
	for _, plan := range c.Plans {
		plan = strings.TrimSpace(plan)
		if plan == "" || slices.Contains(plans, plan) {
			continue
		}
		plans = append(plans, plan)
	}
	c.Plans = plans
	c.Billing.Country = strings.ToUpper(strings.TrimSpace(c.Billing.Country))
	c.Billing.Currency = strings.ToUpper(strings.TrimSpace(c.Billing.Currency))
	c.Billing.Line1 = strings.TrimSpace(c.Billing.Line1)
	c.Billing.City = strings.TrimSpace(c.Billing.City)
	c.Billing.State = strings.TrimSpace(c.Billing.State)
	c.Billing.PostalCode = strings.TrimSpace(c.Billing.PostalCode)
	c.Proxy.Type = strings.ToLower(strings.TrimSpace(c.Proxy.Type))
	c.Proxy.Host = strings.TrimSpace(c.Proxy.Host)
	c.Proxy.Username = strings.TrimSpace(c.Proxy.Username)
}

// Invalid returns the message key of the first malformed value, or "". Empty
// values are allowed so the settings can be filled in over several saves;
// Missing lists what is still needed.
func (c ProductFulfillerConfig) Invalid() string {
	for _, address := range []string{c.URL, c.CallbackURL} {
		if address != "" && !isHTTPURL(address) {
			return "Provide a valid URL starting with http:// or https://"
		}
	}
	if c.Secret != "" && len(c.Secret) < ProductFulfillerSecretMinLength {
		return "The shared secret must be at least 32 characters"
	}
	for _, plan := range c.Plans {
		if !productFulfillerPlanPattern.MatchString(plan) {
			return "Plan codes may only contain letters, digits, dots, underscores and hyphens"
		}
	}
	if c.Billing.Country != "" && !productFulfillerCountryPattern.MatchString(c.Billing.Country) {
		return "The country must be a two-letter code such as US"
	}
	if c.Billing.Currency != "" && !productFulfillerCurrencyPattern.MatchString(c.Billing.Currency) {
		return "The currency must be a three-letter code such as USD"
	}
	if c.Proxy.Type != "" {
		if !slices.Contains(productFulfillerProxyTypes, c.Proxy.Type) {
			return "The proxy type must be http, https, socks5 or ssh"
		}
		if c.Proxy.Host == "" || c.Proxy.Port < 1 || c.Proxy.Port > 65535 {
			return "The proxy needs a host and a port between 1 and 65535"
		}
	}
	return ""
}

func isHTTPURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

// Missing names the settings that must still be filled in before the
// fulfiller can be used, in the order the settings page shows them.
func (c ProductFulfillerConfig) Missing() []string {
	missing := []string{}
	if c.URL == "" {
		missing = append(missing, "url")
	}
	if len(c.Secret) < ProductFulfillerSecretMinLength {
		missing = append(missing, "secret")
	}
	if len(c.Plans) == 0 {
		missing = append(missing, "plans")
	}
	return missing
}

func (c ProductFulfillerConfig) Enabled() bool {
	return len(c.Missing()) == 0
}

// EffectiveCallbackURL is where the fulfiller reports results. It defaults to
// this server on localhost, which fits running the fulfiller next to ez-ai.
func (c ProductFulfillerConfig) EffectiveCallbackURL() string {
	if c.CallbackURL != "" {
		return c.CallbackURL
	}
	return fmt.Sprintf("http://127.0.0.1:%d/api/product/fulfillment/callback", *common.Port)
}

// billingWithDefaults fills in the US checkout when no country or currency
// is set.
func (c ProductFulfillerConfig) billingWithDefaults() ProductFulfillerBilling {
	billing := c.Billing
	if billing.Country == "" {
		billing.Country = "US"
	}
	if billing.Currency == "" {
		billing.Currency = "USD"
	}
	return billing
}

func SignProductFulfillerPayload(secret string, timestamp int64, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(timestamp, 10)))
	mac.Write([]byte("."))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifyProductFulfillerSignature checks a signed fulfiller request and
// rejects timestamps outside the allowed clock skew.
func VerifyProductFulfillerSignature(secret, timestampHeader, signatureHeader string, body []byte, now time.Time) bool {
	if secret == "" || signatureHeader == "" {
		return false
	}
	timestamp, err := strconv.ParseInt(timestampHeader, 10, 64)
	if err != nil {
		return false
	}
	skew := now.Sub(time.Unix(timestamp, 0))
	if skew > productFulfillerMaxClockSkew || skew < -productFulfillerMaxClockSkew {
		return false
	}
	expected := SignProductFulfillerPayload(secret, timestamp, body)
	return hmac.Equal([]byte(expected), []byte(strings.ToLower(signatureHeader)))
}

// SealProductFulfillerPayload encrypts a job for the fulfiller with a key
// derived from the shared secret, so the card never crosses the network in
// plain text. The result is the request body.
func SealProductFulfillerPayload(secret string, plaintext []byte) ([]byte, error) {
	sealed, err := common.SealAESGCM(common.DeriveAESKey(productFulfillerPayloadPurpose, secret), plaintext)
	if err != nil {
		return nil, err
	}
	return common.Marshal(map[string]string{"sealed": base64.StdEncoding.EncodeToString(sealed)})
}

// OpenProductFulfillerPayload decrypts a body written by
// SealProductFulfillerPayload.
func OpenProductFulfillerPayload(secret string, body []byte) ([]byte, error) {
	var envelope struct {
		Sealed string `json:"sealed"`
	}
	if err := common.Unmarshal(body, &envelope); err != nil {
		return nil, err
	}
	sealed, err := base64.StdEncoding.DecodeString(envelope.Sealed)
	if err != nil {
		return nil, err
	}
	return common.OpenAESGCM(common.DeriveAESKey(productFulfillerPayloadPurpose, secret), sealed)
}

// ProductFulfillmentJob is what the fulfiller needs to buy one order.
type ProductFulfillmentJob struct {
	TradeNo string `json:"trade_no"`
	// AttemptId identifies the payment record; the fulfiller sends it back
	// with every progress event and the result.
	AttemptId int    `json:"attempt_id"`
	Provider  string `json:"provider"`
	Plan      string `json:"plan"`
	// AccessToken signs in to ChatGPT; Cookie (a Cookie header with the
	// sessionKey) signs in to Claude.
	AccessToken string `json:"access_token,omitempty"`
	Cookie      string `json:"cookie,omitempty"`
	CallbackURL string `json:"callback_url"`
	// Card is the pooled card chosen for this purchase; the caller sets it.
	Card    ProductFulfillerCard    `json:"card"`
	Billing ProductFulfillerBilling `json:"billing"`
	// Proxy is set when the purchase windows must exit through a proxy.
	Proxy *ProductFulfillerProxy `json:"proxy,omitempty"`
}

// SubmitProductFulfillment hands a job, with the card to pay with, to the
// fulfiller. The fulfiller accepts it and reports the result later through
// the callback.
func SubmitProductFulfillment(config ProductFulfillerConfig, job ProductFulfillmentJob) error {
	job.CallbackURL = config.EffectiveCallbackURL()
	job.Billing = config.billingWithDefaults()
	if config.Proxy.Type != "" {
		job.Proxy = &config.Proxy
	}
	plaintext, err := common.Marshal(job)
	if err != nil {
		return err
	}
	body, err := SealProductFulfillerPayload(config.Secret, plaintext)
	if err != nil {
		return err
	}
	resp, err := sendProductFulfillerRequest(config, http.MethodPost, "/v1/fulfillments", body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusAccepted || resp.StatusCode == http.StatusOK {
		return nil
	}
	detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return fmt.Errorf("fulfiller rejected the job: HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(detail)))
}

// PingProductFulfiller checks that the fulfiller is running and shares the
// secret.
func PingProductFulfiller(config ProductFulfillerConfig) error {
	resp, err := sendProductFulfillerRequest(config, http.MethodGet, "/v1/ping", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return ErrProductFulfillerUnauthorized
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fulfiller ping returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// sendProductFulfillerRequest sends a request signed over its body (empty
// for GET) to the fulfiller.
func sendProductFulfillerRequest(config ProductFulfillerConfig, method, path string, body []byte) (*http.Response, error) {
	if config.URL == "" || len(config.Secret) < ProductFulfillerSecretMinLength {
		return nil, ErrProductFulfillerNotConfigured
	}
	req, err := http.NewRequest(method, config.URL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	timestamp := time.Now().Unix()
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set(ProductFulfillerTimestampHeader, strconv.FormatInt(timestamp, 10))
	req.Header.Set(ProductFulfillerSignatureHeader, SignProductFulfillerPayload(config.Secret, timestamp, body))

	client := &http.Client{Timeout: productFulfillerRequestTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrProductFulfillerUnreachable, err)
	}
	return resp, nil
}
