package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// The product fulfiller is a separate service that buys an order's upstream
// subscription with the DogPay card (services/dogpay-fulfiller). Both
// directions are signed with HMAC-SHA256 over "<unix seconds>.<raw body>"
// using the shared PRODUCT_FULFILLER_SECRET.
const (
	ProductFulfillerTimestampHeader = "X-Fulfiller-Timestamp"
	ProductFulfillerSignatureHeader = "X-Fulfiller-Signature"
	productFulfillerMaxClockSkew    = 5 * time.Minute
	productFulfillerRequestTimeout  = 15 * time.Second
)

var ErrProductFulfillerNotConfigured = errors.New("product fulfiller is not configured")

type ProductFulfillerConfig struct {
	URL         string
	Secret      string
	CallbackURL string
}

// GetProductFulfillerConfig reads the fulfiller settings from the environment.
// The callback URL defaults to this server on localhost, which fits running
// the fulfiller next to ez-ai.
func GetProductFulfillerConfig() ProductFulfillerConfig {
	callbackURL := strings.TrimSpace(common.GetEnvOrDefaultString("PRODUCT_FULFILLER_CALLBACK_URL", ""))
	if callbackURL == "" {
		callbackURL = fmt.Sprintf("http://127.0.0.1:%d/api/product/fulfillment/callback", *common.Port)
	}
	return ProductFulfillerConfig{
		URL:         strings.TrimRight(strings.TrimSpace(common.GetEnvOrDefaultString("PRODUCT_FULFILLER_URL", "")), "/"),
		Secret:      common.GetEnvOrDefaultString("PRODUCT_FULFILLER_SECRET", ""),
		CallbackURL: callbackURL,
	}
}

func (c ProductFulfillerConfig) Enabled() bool {
	return c.URL != "" && len(c.Secret) >= 32
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

// ProductFulfillmentJob is what the fulfiller needs to buy one order.
type ProductFulfillmentJob struct {
	TradeNo     string `json:"trade_no"`
	Plan        string `json:"plan"`
	AccessToken string `json:"access_token"`
	CallbackURL string `json:"callback_url"`
}

// SubmitProductFulfillment hands a job to the fulfiller. The fulfiller
// accepts it and reports the result later through the callback.
func SubmitProductFulfillment(config ProductFulfillerConfig, job ProductFulfillmentJob) error {
	if !config.Enabled() {
		return ErrProductFulfillerNotConfigured
	}
	job.CallbackURL = config.CallbackURL
	body, err := common.Marshal(job)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, config.URL+"/v1/fulfillments", bytes.NewReader(body))
	if err != nil {
		return err
	}
	timestamp := time.Now().Unix()
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(ProductFulfillerTimestampHeader, strconv.FormatInt(timestamp, 10))
	req.Header.Set(ProductFulfillerSignatureHeader, SignProductFulfillerPayload(config.Secret, timestamp, body))

	client := &http.Client{Timeout: productFulfillerRequestTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("fulfiller request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusAccepted || resp.StatusCode == http.StatusOK {
		return nil
	}
	detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return fmt.Errorf("fulfiller rejected the job: HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(detail)))
}
