package controller

import (
	"errors"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
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

// productFulfillerMissingCards is listed in "missing" when no card in the pool
// can pay right now.
const productFulfillerMissingCards = "cards"

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
	missing := config.Missing()
	hasCard, err := hasPayableCard(time.Now())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !hasCard {
		missing = append(missing, productFulfillerMissingCards)
	}
	if len(missing) > 0 {
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

// hasPayableCard reports whether the pool has a card that is enabled and not
// expired. A card that is only busy with another order still counts.
func hasPayableCard(now time.Time) (bool, error) {
	cards, err := model.ListPaymentCards()
	if err != nil {
		return false, err
	}
	for _, card := range cards {
		status := card.Status(now)
		if status == model.PaymentCardStatusReady || status == model.PaymentCardStatusInUse {
			return true, nil
		}
	}
	return false, nil
}

// productFulfillmentConfigView is the saved fulfiller settings as the
// settings page shows them: secrets are reported as set or not. Cards are
// managed separately in the card pool.
type productFulfillmentConfigView struct {
	EncryptionReady     bool                            `json:"encryption_ready"`
	Readable            bool                            `json:"readable"`
	URL                 string                          `json:"url"`
	CallbackURL         string                          `json:"callback_url"`
	DefaultCallbackURL  string                          `json:"default_callback_url"`
	Plans               []string                        `json:"plans"`
	HasSecret           bool                            `json:"has_secret"`
	Billing             service.ProductFulfillerBilling `json:"billing"`
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
	view.Billing = config.Billing
	common.ApiSuccess(c, view)
}

// productFulfillmentConfigUpdate replaces the fulfiller settings. Secret
// fields are pointers: leaving one out keeps the saved value, and an empty
// string clears it.
type productFulfillmentConfigUpdate struct {
	URL         string                          `json:"url"`
	CallbackURL string                          `json:"callback_url"`
	Plans       []string                        `json:"plans"`
	Billing     service.ProductFulfillerBilling `json:"billing"`
	Secret      *string                         `json:"secret"`
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
		URL:         req.URL,
		Secret:      saved.Secret,
		CallbackURL: req.CallbackURL,
		Plans:       req.Plans,
		Billing:     req.Billing,
	}
	if req.Secret != nil {
		config.Secret = *req.Secret
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

// paymentCardView is a pooled card as the admin page shows it. The number and
// CVC are never part of it; only the brand and the last four digits are.
type paymentCardView struct {
	Id             int    `json:"id"`
	Label          string `json:"label"`
	Provider       string `json:"provider"`
	Brand          string `json:"brand"`
	Last4          string `json:"last4"`
	ExpiryMonth    int    `json:"expiry_month"`
	ExpiryYear     int    `json:"expiry_year"`
	Holder         string `json:"holder"`
	Enabled        bool   `json:"enabled"`
	Priority       int    `json:"priority"`
	Status         string `json:"status"`
	DisabledReason string `json:"disabled_reason"`
	LastUsedAt     int64  `json:"last_used_at"`
	SuccessCount   int    `json:"success_count"`
	FailCount      int    `json:"fail_count"`
}

func newPaymentCardView(card model.PaymentCard, now time.Time) paymentCardView {
	return paymentCardView{
		Id:             card.Id,
		Label:          card.Label,
		Provider:       card.Provider,
		Brand:          card.Brand,
		Last4:          card.Last4,
		ExpiryMonth:    card.ExpiryMonth,
		ExpiryYear:     card.ExpiryYear,
		Holder:         card.Holder,
		Enabled:        card.Enabled,
		Priority:       card.Priority,
		Status:         card.Status(now),
		DisabledReason: card.DisabledReason,
		LastUsedAt:     card.LastUsedAt,
		SuccessCount:   card.SuccessCount,
		FailCount:      card.FailCount,
	}
}

// AdminListPaymentCards returns the card pool, best card first.
func AdminListPaymentCards(c *gin.Context) {
	cards, err := model.ListPaymentCards()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	now := time.Now()
	views := make([]paymentCardView, 0, len(cards))
	for _, card := range cards {
		views = append(views, newPaymentCardView(card, now))
	}
	common.ApiSuccess(c, views)
}

// AdminCreatePaymentCard adds a card to the pool. The number and CVC are
// encrypted before they are stored.
func AdminCreatePaymentCard(c *gin.Context) {
	var req service.PaymentCardInput
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	card, err := service.CreatePaymentCard(req)
	if err != nil {
		respondPaymentCardError(c, err)
		return
	}
	common.SysLog(common.LogText("payment card %d (%s) added by user %d", card.Id, card.Snapshot(), c.GetInt("id")))
	common.ApiSuccess(c, newPaymentCardView(*card, time.Now()))
}

// AdminUpdatePaymentCard changes a card in the pool. Fields left out keep
// their value; a number or CVC is only replaced when one is sent.
func AdminUpdatePaymentCard(c *gin.Context) {
	id, ok := paymentCardIdParam(c)
	if !ok {
		return
	}
	var req service.PaymentCardInput
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	card, err := service.UpdatePaymentCard(id, req)
	if err != nil {
		respondPaymentCardError(c, err)
		return
	}
	common.SysLog(common.LogText("payment card %d updated by user %d", card.Id, c.GetInt("id")))
	common.ApiSuccess(c, newPaymentCardView(*card, time.Now()))
}

// AdminDeletePaymentCard removes a card from the pool. A card that is paying
// for an order cannot be removed.
func AdminDeletePaymentCard(c *gin.Context) {
	id, ok := paymentCardIdParam(c)
	if !ok {
		return
	}
	if err := model.DeletePaymentCard(id); err != nil {
		respondPaymentCardError(c, err)
		return
	}
	common.SysLog(common.LogText("payment card %d deleted by user %d", id, c.GetInt("id")))
	common.ApiSuccess(c, gin.H{"id": id})
}

func paymentCardIdParam(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return 0, false
	}
	return id, true
}

// respondPaymentCardError maps the card pool errors to messages the admin
// can act on; anything else is an internal error.
func respondPaymentCardError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrPaymentCardDuplicate),
		errors.Is(err, model.ErrPaymentCardInUse),
		errors.Is(err, service.ErrPaymentCardInvalidNumber),
		errors.Is(err, service.ErrPaymentCardInvalidExpiry),
		errors.Is(err, service.ErrPaymentCardInvalidCVC),
		errors.Is(err, service.ErrPaymentCardInvalidLabel),
		errors.Is(err, service.ErrPaymentCardInvalidHolder),
		errors.Is(err, service.ErrPaymentCardInvalidSource):
		common.ApiErrorT(c, err.Error())
	case errors.Is(err, common.ErrConfigEncryptionKeyMissing):
		common.ApiErrorT(c, "Set CONFIG_ENCRYPTION_KEY (at least 32 characters) on the server and restart it before saving these settings")
	case errors.Is(err, gorm.ErrRecordNotFound):
		common.ApiErrorT(c, "Card not found")
	default:
		common.ApiError(c, err)
	}
}
