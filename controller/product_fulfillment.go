package controller

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// Fulfiller states reported to the admin, each with its own setup guidance.
const (
	productFulfillerReady            = "ok"
	productFulfillerKeyMissing       = "key_missing"
	productFulfillerConfigUnreadable = "config_unreadable"
	productFulfillerNotConfigured    = "not_configured"
	productFulfillerUnreachable      = "unreachable"
	productFulfillerUnauthorized     = "unauthorized"
	productFulfillerFailed           = "error"
)

// AdminGetProductFulfillmentStatus reports whether the fulfiller can take a
// payment and the plans it may buy, for the admin to choose from on "Execute
// payment". A broken setup is a status, not a request failure, so the page
// can say what to fix.
func AdminGetProductFulfillmentStatus(c *gin.Context) {
	status := gin.H{
		"status":       productFulfillerReady,
		"plans":        []string{},
		"claude_plans": []string{},
		"service_url":  "",
		"missing":      []string{},
	}
	if !common.ConfigEncryptionReady() {
		status["status"] = productFulfillerKeyMissing
		common.ApiSuccess(c, status)
		return
	}
	config, err := service.LoadProductFulfillerConfig()
	if err != nil {
		status["status"] = productFulfillerConfigUnreadable
		common.ApiSuccess(c, status)
		return
	}
	status["service_url"] = config.URL
	if missing := config.Missing(); len(missing) > 0 {
		status["status"] = productFulfillerNotConfigured
		status["missing"] = missing
		common.ApiSuccess(c, status)
		return
	}
	err = service.PingProductFulfiller(config)
	switch {
	case err == nil:
		status["plans"] = config.Plans
		status["claude_plans"] = service.ProductFulfillerClaudePlans
	case errors.Is(err, service.ErrProductFulfillerUnreachable):
		status["status"] = productFulfillerUnreachable
	case errors.Is(err, service.ErrProductFulfillerUnauthorized):
		status["status"] = productFulfillerUnauthorized
	default:
		status["status"] = productFulfillerFailed
	}
	if err != nil {
		common.SysError(common.LogText("failed to reach the product fulfiller: %s", err.Error()))
	}
	common.ApiSuccess(c, status)
}

// productFulfillmentConfigView is the saved fulfiller settings as the
// settings page shows them: secrets are reported as set or not, and only the
// last four digits of the card number are returned.
type productFulfillmentConfigView struct {
	EncryptionReady     bool                            `json:"encryption_ready"`
	Readable            bool                            `json:"readable"`
	URL                 string                          `json:"url"`
	CallbackURL         string                          `json:"callback_url"`
	DefaultCallbackURL  string                          `json:"default_callback_url"`
	Plans               []string                        `json:"plans"`
	HasSecret           bool                            `json:"has_secret"`
	CardLast4           string                          `json:"card_last4"`
	CardExpiry          string                          `json:"card_expiry"`
	HasCardCVC          bool                            `json:"has_card_cvc"`
	CardHolder          string                          `json:"card_holder"`
	Billing             service.ProductFulfillerBilling `json:"billing"`
	HasBrowserProxy     bool                            `json:"has_browser_proxy"`
	SecretMinLength     int                             `json:"secret_min_length"`
	EncryptionKeyLength int                             `json:"encryption_key_min_length"`
}

// AdminGetProductFulfillmentConfig returns the saved fulfiller settings
// without their secrets.
func AdminGetProductFulfillmentConfig(c *gin.Context) {
	view := productFulfillmentConfigView{
		EncryptionReady:     common.ConfigEncryptionReady(),
		Plans:               []string{},
		SecretMinLength:     service.ProductFulfillerSecretMinLength,
		EncryptionKeyLength: common.ConfigEncryptionKeyMinLength,
	}
	config := service.ProductFulfillerConfig{}
	if view.EncryptionReady {
		loaded, err := service.LoadProductFulfillerConfig()
		view.Readable = err == nil
		if err == nil {
			config = loaded
		}
	}
	view.URL = config.URL
	view.CallbackURL = config.CallbackURL
	view.DefaultCallbackURL = service.ProductFulfillerConfig{}.EffectiveCallbackURL()
	if len(config.Plans) > 0 {
		view.Plans = config.Plans
	}
	view.HasSecret = config.Secret != ""
	if number := config.Card.Number; len(number) >= 4 {
		view.CardLast4 = number[len(number)-4:]
	}
	view.CardExpiry = config.Card.Expiry
	view.HasCardCVC = config.Card.CVC != ""
	view.CardHolder = config.Card.Holder
	view.Billing = config.Billing
	view.HasBrowserProxy = config.BrowserProxy != ""
	common.ApiSuccess(c, view)
}

// productFulfillmentConfigUpdate replaces the fulfiller settings. Secret
// fields are pointers: leaving one out keeps the saved value, and an empty
// string clears it.
type productFulfillmentConfigUpdate struct {
	URL          string                          `json:"url"`
	CallbackURL  string                          `json:"callback_url"`
	Plans        []string                        `json:"plans"`
	CardExpiry   string                          `json:"card_expiry"`
	CardHolder   string                          `json:"card_holder"`
	Billing      service.ProductFulfillerBilling `json:"billing"`
	Secret       *string                         `json:"secret"`
	CardNumber   *string                         `json:"card_number"`
	CardCVC      *string                         `json:"card_cvc"`
	BrowserProxy *string                         `json:"browser_proxy"`
}

// AdminUpdateProductFulfillmentConfig validates the fulfiller settings and
// stores them encrypted with CONFIG_ENCRYPTION_KEY.
func AdminUpdateProductFulfillmentConfig(c *gin.Context) {
	var req productFulfillmentConfigUpdate
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if !common.ConfigEncryptionReady() {
		common.ApiErrorT(c, "Set CONFIG_ENCRYPTION_KEY (at least 32 characters) on the server and restart it before saving these settings")
		return
	}
	// Settings that cannot be decrypted any more are replaced as a whole,
	// so their secrets must be entered again.
	saved, err := service.LoadProductFulfillerConfig()
	if err != nil {
		saved = service.ProductFulfillerConfig{}
	}
	config := service.ProductFulfillerConfig{
		URL:          req.URL,
		Secret:       saved.Secret,
		CallbackURL:  req.CallbackURL,
		Plans:        req.Plans,
		Card:         service.ProductFulfillerCard{Number: saved.Card.Number, Expiry: req.CardExpiry, CVC: saved.Card.CVC, Holder: req.CardHolder},
		Billing:      req.Billing,
		BrowserProxy: saved.BrowserProxy,
	}
	if req.Secret != nil {
		config.Secret = *req.Secret
	}
	if req.CardNumber != nil {
		config.Card.Number = *req.CardNumber
	}
	if req.CardCVC != nil {
		config.Card.CVC = *req.CardCVC
	}
	if req.BrowserProxy != nil {
		config.BrowserProxy = *req.BrowserProxy
	}
	config.Normalize()
	if msg := config.Invalid(); msg != "" {
		common.ApiErrorT(c, msg)
		return
	}
	if err := service.SaveProductFulfillerConfig(config); err != nil {
		common.ApiError(c, err)
		return
	}
	common.SysLog(common.LogText("product fulfillment settings updated by user %d", c.GetInt("id")))
	AdminGetProductFulfillmentConfig(c)
}
