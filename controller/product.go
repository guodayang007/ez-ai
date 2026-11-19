package controller

import (
	"encoding/base64"
	"errors"
	"io"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	productMaxSkus               = 50
	productMaxInputFields        = 20
	productInputDefaultMaxLength = 64 * 1024
	productInputHardMaxLength    = 1024 * 1024
	productInputsTotalMaxLength  = 4 * 1024 * 1024
	productMaxPriceAmount        = 1000000
	productMaxPendingOrders      = 20
)

var (
	productInputKeyPattern        = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)
	productFulfillmentPlanPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)
	productCurrencyPattern        = regexp.MustCompile(`^[A-Z]{3,8}$`)
	productInputTypes             = map[string]bool{
		model.ProductInputText:           true,
		model.ProductInputTextarea:       true,
		model.ProductInputSecret:         true,
		model.ProductInputJSON:           true,
		model.ProductInputBase64:         true,
		model.ProductInputChatGPTSession: true,
		model.ProductInputClaudeCookie:   true,
	}
	// A ChatGPT access token is a JWT: three base64url segments.
	chatGPTAccessTokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)
)

// normalizeProduct trims and validates an admin product payload in place and
// returns the English message key of the first problem found.
func normalizeProduct(product *model.Product) (string, map[string]any) {
	product.Title = strings.TrimSpace(product.Title)
	product.Subtitle = strings.TrimSpace(product.Subtitle)
	product.Icon = strings.TrimSpace(product.Icon)
	product.Description = strings.TrimSpace(product.Description)
	if product.Title == "" || utf8.RuneCountInString(product.Title) > 128 {
		return "Product title must be 1-128 characters", nil
	}
	if utf8.RuneCountInString(product.Subtitle) > 255 {
		return "Product subtitle cannot exceed 255 characters", nil
	}
	if len(product.Icon) > 1024 {
		return "Product icon cannot exceed 1024 characters", nil
	}
	if len(product.Skus) == 0 {
		return "A product needs at least one specification", nil
	}
	if len(product.Skus) > productMaxSkus {
		return "A product can have at most {{max}} specifications", map[string]any{"max": productMaxSkus}
	}
	for i := range product.Skus {
		sku := &product.Skus[i]
		sku.Name = strings.TrimSpace(sku.Name)
		if sku.Name == "" || utf8.RuneCountInString(sku.Name) > 128 {
			return "Specification name must be 1-128 characters", nil
		}
		if math.IsNaN(sku.PriceAmount) || sku.PriceAmount < 0 || sku.PriceAmount > productMaxPriceAmount {
			return "Price must be between 0 and {{max}}", map[string]any{"max": productMaxPriceAmount}
		}
		sku.PriceAmount = math.Round(sku.PriceAmount*100) / 100
		if math.IsNaN(sku.OriginalPrice) || sku.OriginalPrice < 0 || sku.OriginalPrice > productMaxPriceAmount {
			return "Price must be between 0 and {{max}}", map[string]any{"max": productMaxPriceAmount}
		}
		sku.OriginalPrice = math.Round(sku.OriginalPrice*100) / 100
		if sku.OriginalPrice > 0 && sku.OriginalPrice < sku.PriceAmount {
			return "Original price cannot be lower than the price", nil
		}
		sku.Tag = strings.TrimSpace(sku.Tag)
		if utf8.RuneCountInString(sku.Tag) > 32 {
			return "Tag cannot exceed 32 characters", nil
		}
		sku.Currency = strings.ToUpper(strings.TrimSpace(sku.Currency))
		if sku.Currency == "" {
			sku.Currency = "USD"
		}
		if !productCurrencyPattern.MatchString(sku.Currency) {
			return "Invalid currency code", nil
		}
	}
	return normalizeProductInputFields(product.InputFields)
}

func normalizeProductInputFields(fields []model.ProductInputField) (string, map[string]any) {
	if len(fields) > productMaxInputFields {
		return "A product can have at most {{max}} order fields", map[string]any{"max": productMaxInputFields}
	}
	seen := map[string]bool{}
	for i := range fields {
		field := &fields[i]
		field.Key = strings.TrimSpace(field.Key)
		field.Label = strings.TrimSpace(field.Label)
		field.Placeholder = strings.TrimSpace(field.Placeholder)
		field.Description = strings.TrimSpace(field.Description)
		if !productInputKeyPattern.MatchString(field.Key) {
			return "Field key must start with a lowercase letter and contain only lowercase letters, digits and underscores (max 32)", nil
		}
		if seen[field.Key] {
			return "Duplicate field key: {{key}}", map[string]any{"key": field.Key}
		}
		seen[field.Key] = true
		if field.Label == "" || utf8.RuneCountInString(field.Label) > 64 {
			return "Field label must be 1-64 characters", nil
		}
		if !productInputTypes[field.Type] {
			return "Invalid field type: {{type}}", map[string]any{"type": field.Type}
		}
		if field.MaxLength <= 0 {
			field.MaxLength = productInputDefaultMaxLength
		}
		field.MaxLength = min(field.MaxLength, productInputHardMaxLength)
	}
	return "", nil
}

// validateProductOrderInputs checks buyer-submitted values against the product's
// field definitions. Values for undeclared keys are dropped.
func validateProductOrderInputs(fields []model.ProductInputField, submitted map[string]string) (map[string]string, string, map[string]any) {
	inputs := make(map[string]string, len(fields))
	totalLength := 0
	for _, field := range fields {
		value := strings.TrimSpace(submitted[field.Key])
		if value == "" {
			if field.Required {
				return nil, "{{field}} is required", map[string]any{"field": field.Label}
			}
			continue
		}
		maxLength := field.MaxLength
		if maxLength <= 0 {
			maxLength = productInputDefaultMaxLength
		}
		if len(value) > maxLength {
			return nil, "{{field}} cannot exceed {{max}} characters", map[string]any{"field": field.Label, "max": maxLength}
		}
		switch field.Type {
		case model.ProductInputJSON:
			var parsed any
			if err := common.UnmarshalJsonStr(value, &parsed); err != nil {
				return nil, "{{field}} must be valid JSON", map[string]any{"field": field.Label}
			}
		case model.ProductInputBase64:
			value = strings.Join(strings.Fields(value), "")
			if _, err := base64.StdEncoding.DecodeString(value); err != nil {
				if _, err := base64.URLEncoding.DecodeString(value); err != nil {
					return nil, "{{field}} must be valid Base64", map[string]any{"field": field.Label}
				}
			}
		case model.ProductInputChatGPTSession:
			if msg := validateChatGPTSession(value, time.Now()); msg != "" {
				return nil, msg, nil
			}
		case model.ProductInputClaudeCookie:
			value = model.NormalizeClaudeCookie(value)
			if value == "" {
				return nil, productClaudeCookieInvalid, nil
			}
		}
		totalLength += len(value)
		if totalLength > productInputsTotalMaxLength {
			return nil, "Submitted information is too large", nil
		}
		inputs[field.Key] = value
	}
	return inputs, "", nil
}

const productClaudeCookieInvalid = "The cookie must contain the sessionKey copied from claude.ai"

// validateChatGPTSession checks the JSON copied from
// chatgpt.com/api/auth/session and returns the English message key of the
// first problem. It mirrors parseChatGPTSession in the web storefront.
func validateChatGPTSession(value string, now time.Time) string {
	var session struct {
		AccessToken string `json:"accessToken"`
		Expires     string `json:"expires"`
	}
	if !strings.HasPrefix(value, "{") || common.UnmarshalJsonStr(value, &session) != nil {
		return "The session must be the full JSON copied from the ChatGPT session page"
	}
	if !chatGPTAccessTokenPattern.MatchString(session.AccessToken) {
		return "The session has no access token, please sign in to ChatGPT and copy it again"
	}
	if expires, err := time.Parse(time.RFC3339, session.Expires); err == nil && !expires.After(now) {
		return "The session has expired, please refresh the ChatGPT session page and copy it again"
	}
	return ""
}

func productIdParam(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid ID")
		return 0, false
	}
	return id, true
}

// ---------------------------------------------------------------------------
// Storefront
// ---------------------------------------------------------------------------

func GetProducts(c *gin.Context) {
	products, err := model.ListProducts(true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, products)
}

type CreateProductOrderRequest struct {
	SkuId  int               `json:"sku_id"`
	Inputs map[string]string `json:"inputs"`
	Remark string            `json:"remark"`
}

func CreateProductOrder(c *gin.Context) {
	userId := c.GetInt("id")
	var req CreateProductOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.SkuId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	req.Remark = strings.TrimSpace(req.Remark)
	if utf8.RuneCountInString(req.Remark) > 500 {
		common.ApiErrorT(c, "Remark cannot exceed 500 characters")
		return
	}
	product, sku, err := model.GetSellableSku(req.SkuId)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorT(c, "This product is not available")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	inputs, msg, params := validateProductOrderInputs(product.InputFields, req.Inputs)
	if msg != "" {
		common.ApiErrorT(c, msg, params)
		return
	}
	pending, err := model.CountUserProductOrders(userId, model.ProductOrderPending)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if pending >= productMaxPendingOrders {
		common.ApiErrorT(c, "Too many pending orders, please wait for them to be processed or cancel some")
		return
	}
	order := &model.ProductOrder{
		UserId:       userId,
		ProductId:    product.Id,
		SkuId:        sku.Id,
		ProductTitle: product.Title,
		SkuName:      sku.Name,
		PriceAmount:  sku.PriceAmount,
		Currency:     sku.Currency,
		InputFields:  product.InputFields,
		Inputs:       inputs,
		Remark:       req.Remark,
	}
	if err := model.CreateProductOrder(order); err != nil {
		common.ApiError(c, err)
		return
	}
	order.RedactForBuyer()
	common.ApiSuccess(c, order)
}

func GetSelfProductOrders(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	orders, total, err := model.ListProductOrders(model.ProductOrderQuery{
		UserId:  c.GetInt("id"),
		Status:  c.Query("status"),
		Keyword: c.Query("keyword"),
	}, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for i := range orders {
		orders[i].RedactForBuyer()
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orders)
	common.ApiSuccess(c, pageInfo)
}

func CancelSelfProductOrder(c *gin.Context) {
	id, ok := productIdParam(c)
	if !ok {
		return
	}
	order, err := model.GetProductOrder(id)
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && order.UserId != c.GetInt("id")) {
		common.ApiErrorT(c, "Order not found")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if order.Status != model.ProductOrderPending {
		common.ApiErrorT(c, "Only pending orders can be cancelled")
		return
	}
	if err := model.UpdateProductOrderStatus(id, model.ProductOrderPending, model.ProductOrderCancelled, nil); err != nil {
		if errors.Is(err, model.ErrProductOrderStatusConflict) {
			common.ApiErrorT(c, "Order status has changed, please refresh")
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

func AdminListProducts(c *gin.Context) {
	products, err := model.ListProducts(false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, products)
}

func AdminCreateProduct(c *gin.Context) {
	var product model.Product
	if err := c.ShouldBindJSON(&product); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	product.Id = 0
	if msg, params := normalizeProduct(&product); msg != "" {
		common.ApiErrorT(c, msg, params)
		return
	}
	if err := model.SaveProduct(&product); err != nil {
		common.ApiError(c, err)
		return
	}
	saved, err := model.GetProductById(product.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, saved)
}

func AdminUpdateProduct(c *gin.Context) {
	id, ok := productIdParam(c)
	if !ok {
		return
	}
	var product model.Product
	if err := c.ShouldBindJSON(&product); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	product.Id = id
	if msg, params := normalizeProduct(&product); msg != "" {
		common.ApiErrorT(c, msg, params)
		return
	}
	if err := model.SaveProduct(&product); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorT(c, "Product not found")
			return
		}
		common.ApiError(c, err)
		return
	}
	saved, err := model.GetProductById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, saved)
}

type AdminUpdateProductStatusRequest struct {
	Enabled *bool `json:"enabled"`
}

func AdminUpdateProductStatus(c *gin.Context) {
	id, ok := productIdParam(c)
	if !ok {
		return
	}
	var req AdminUpdateProductStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Enabled == nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.SetProductEnabled(id, *req.Enabled); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorT(c, "Product not found")
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func AdminDeleteProduct(c *gin.Context) {
	id, ok := productIdParam(c)
	if !ok {
		return
	}
	if err := model.DeleteProduct(id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorT(c, "Product not found")
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func AdminListProductOrders(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	userId, _ := strconv.Atoi(c.Query("user_id"))
	orders, total, err := model.ListProductOrders(model.ProductOrderQuery{
		UserId:  userId,
		Status:  c.Query("status"),
		Keyword: c.Query("keyword"),
	}, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.FillProductOrderUsernames(orders); err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orders)
	common.ApiSuccess(c, pageInfo)
}

type AdminUpdateProductOrderRequest struct {
	Status       string  `json:"status"`
	DeliveryNote *string `json:"delivery_note"`
}

func AdminUpdateProductOrder(c *gin.Context) {
	id, ok := productIdParam(c)
	if !ok {
		return
	}
	var req AdminUpdateProductOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if req.DeliveryNote != nil {
		note := strings.TrimSpace(*req.DeliveryNote)
		if utf8.RuneCountInString(note) > 5000 {
			common.ApiErrorT(c, "Delivery note cannot exceed 5000 characters")
			return
		}
		req.DeliveryNote = &note
	}
	order, err := model.GetProductOrder(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorT(c, "Order not found")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}

	if req.Status == "" || req.Status == order.Status {
		if req.DeliveryNote != nil {
			if err := model.UpdateProductOrderDeliveryNote(id, *req.DeliveryNote); err != nil {
				common.ApiError(c, err)
				return
			}
		}
	} else {
		if !model.CanTransitionProductOrder(order.Status, req.Status) {
			common.ApiErrorT(c, "Order cannot change from {{from}} to {{to}}", map[string]any{"from": order.Status, "to": req.Status})
			return
		}
		if err := model.UpdateProductOrderStatus(id, order.Status, req.Status, req.DeliveryNote); err != nil {
			if errors.Is(err, model.ErrProductOrderStatusConflict) {
				common.ApiErrorT(c, "Order status has changed, please refresh")
				return
			}
			common.ApiError(c, err)
			return
		}
	}

	updated, err := model.GetProductOrder(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, updated)
}

type productExecutePaymentRequest struct {
	Plan string `json:"plan"`
	// CardId is the pooled card to pay with; 0 lets ez-ai choose.
	CardId int `json:"card_id"`
}

// AdminExecuteProductOrderPayment starts the automatic purchase of an order
// in any status: the fulfiller service pays for the plan the admin chose with the
// DogPay card on the buyer's ChatGPT or Claude account and reports back through
// ProductFulfillmentCallback. Every click that reaches a valid order is kept
// as a payment record with its steps, including clicks rejected by the checks
// below.
func AdminExecuteProductOrderPayment(c *gin.Context) {
	id, ok := productIdParam(c)
	if !ok {
		return
	}
	var req productExecutePaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	req.Plan = strings.TrimSpace(req.Plan)
	if !productFulfillmentPlanPattern.MatchString(req.Plan) {
		common.ApiErrorT(c, "Choose a plan to buy")
		return
	}
	order, err := model.GetProductOrder(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorT(c, "Order not found")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// A click while a purchase runs is a duplicate, not a new attempt.
	if !model.CanStartProductFulfillment(order) {
		common.ApiErrorT(c, "Automatic payment is already running for this order")
		return
	}
	attempt, err := model.CreateProductFulfillmentAttempt(order, req.Plan, c.GetInt("id"), c.GetString("username"))
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// The checks below leave the order as it was; only the record shows them.
	failCheck := ""
	config, err := service.LoadProductFulfillerConfig()
	job := service.ProductFulfillmentJob{
		TradeNo:     order.TradeNo,
		AttemptId:   attempt.Id,
		Plan:        req.Plan,
		AccessToken: order.ChatGPTAccessToken(),
		Cookie:      order.ClaudeCookie(),
	}
	plans := config.Plans
	job.Provider = service.ProductFulfillmentProviderChatGPT
	if job.Cookie != "" {
		plans = service.ProductFulfillerClaudePlans
		job.Provider = service.ProductFulfillmentProviderClaude
	}
	switch {
	case err != nil || !config.Enabled():
		failCheck = "Automatic fulfillment is not configured"
	case job.AccessToken == "" && job.Cookie == "":
		failCheck = "This order has no ChatGPT session or Claude cookie"
	case !slices.Contains(plans, req.Plan):
		failCheck = "The fulfillment service does not offer this plan"
	}
	if failCheck == "" && job.Provider == service.ProductFulfillmentProviderChatGPT {
		for _, field := range order.InputFields {
			if field.Type != model.ProductInputChatGPTSession {
				continue
			}
			if msg := validateChatGPTSession(order.Inputs[field.Key], time.Now()); msg != "" {
				failCheck = msg
				break
			}
		}
	}
	// The card is held from here on; every failure below ends the attempt,
	// which releases it.
	if failCheck == "" {
		card, err := model.LeasePaymentCard(attempt.Id, req.CardId, time.Now())
		switch {
		case errors.Is(err, model.ErrPaymentCardUnavailable):
			failCheck = "No payment card is ready for this purchase"
		case err != nil:
			common.SysError(common.LogText("failed to choose a payment card for product order %s: %s", order.TradeNo, err.Error()))
			failCheck = "Unexpected error while choosing a payment card"
		default:
			job.Card, err = service.DecryptPaymentCard(card)
			if err != nil {
				failCheck = "The payment card cannot be read with the current CONFIG_ENCRYPTION_KEY"
			}
		}
	}
	if failCheck != "" {
		recordProductFulfillmentEvent(attempt, model.ProductFulfillmentStepPrepare, model.ProductFulfillmentStepFailed, failCheck, nil, model.ProductFulfillmentFailed)
		common.ApiErrorT(c, failCheck)
		return
	}

	if err := model.StartProductOrderFulfillment(id, req.Plan, attempt.Id, order.Status, order.FulfillmentStatus); err != nil {
		if errors.Is(err, model.ErrProductOrderStatusConflict) {
			recordProductFulfillmentEvent(attempt, model.ProductFulfillmentStepPrepare, model.ProductFulfillmentStepFailed,
				"Order status has changed, please refresh", nil, model.ProductFulfillmentFailed)
			common.ApiErrorT(c, "Order status has changed, please refresh")
			return
		}
		recordProductFulfillmentEvent(attempt, model.ProductFulfillmentStepPrepare, model.ProductFulfillmentStepFailed,
			"Unexpected error: {{error}}", map[string]string{"error": err.Error()}, model.ProductFulfillmentFailed)
		common.ApiError(c, err)
		return
	}
	recordProductFulfillmentEvent(attempt, model.ProductFulfillmentStepPrepare, model.ProductFulfillmentStepSucceeded,
		"The order and the fulfillment settings are ready; buying {{plan}}", map[string]string{"plan": req.Plan}, "")
	recordProductFulfillmentEvent(attempt, model.ProductFulfillmentStepSubmit, model.ProductFulfillmentStepRunning,
		"Sending the job to the fulfillment service at {{url}}", map[string]string{"url": config.URL}, "")
	submitErr := service.SubmitProductFulfillment(config, job)
	if submitErr != nil {
		common.SysError(common.LogText("failed to submit product order %s to fulfiller: %s", order.TradeNo, submitErr.Error()))
		if err := model.FinishProductOrderFulfillment(order.TradeNo, attempt.Id, false, submitErr.Error(), ""); err != nil {
			common.SysError(common.LogText("failed to record fulfiller failure of product order %s: %s", order.TradeNo, err.Error()))
		}
		recordProductFulfillmentEvent(attempt, model.ProductFulfillmentStepSubmit, model.ProductFulfillmentStepFailed,
			"The fulfillment service did not accept the job: {{error}}", map[string]string{"error": submitErr.Error()}, model.ProductFulfillmentFailed)
		common.ApiErrorT(c, "The fulfillment service did not accept the order")
		return
	}
	recordProductFulfillmentEvent(attempt, model.ProductFulfillmentStepSubmit, model.ProductFulfillmentStepSucceeded,
		"The fulfillment service accepted the job", nil, "")

	updated, err := model.GetProductOrder(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, updated)
}

// recordProductFulfillmentEvent adds a step event written by ez-ai to the
// payment record. The record only explains the payment, so failing to write
// it is logged instead of failing the payment. An attempt that has already
// ended (the fulfiller can finish before ez-ai notes that it accepted the
// job) is left alone.
func recordProductFulfillmentEvent(attempt *model.ProductFulfillmentAttempt, step, status, message string, params map[string]string, finalStatus string) {
	event := model.NewProductFulfillmentEvent(step, status, message, params)
	err := model.RecordProductFulfillmentEvent(attempt.Id, attempt.TradeNo, event, finalStatus)
	if err != nil && !errors.Is(err, model.ErrProductOrderStatusConflict) {
		common.SysError(common.LogText("failed to record payment step %s of product order %s: %s", step, attempt.TradeNo, err.Error()))
	}
}

// AdminListProductOrderFulfillments returns every payment record of the
// order, newest first, with each step and the detailed log.
func AdminListProductOrderFulfillments(c *gin.Context) {
	id, ok := productIdParam(c)
	if !ok {
		return
	}
	attempts, err := model.ListProductFulfillmentAttempts(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, attempts)
}

const productFulfillmentCallbackProgress = "progress"

// productFulfillmentCallbackRequest is a progress event (type "progress") or
// the final result (any other type) of a purchase. MessageKey and Params are
// the translatable form of Message.
type productFulfillmentCallbackRequest struct {
	Type string `json:"type"`
	// CardOutcome says what the purchase tells about the card: success,
	// declined, needs_verification or failed. Empty when the fulfiller does
	// not know; the success flag is used then.
	CardOutcome  string            `json:"card_outcome"`
	TradeNo      string            `json:"trade_no"`
	AttemptId    int               `json:"attempt_id"`
	Step         string            `json:"step"`
	Status       string            `json:"status"`
	Success      bool              `json:"success"`
	Message      string            `json:"message"`
	MessageKey   string            `json:"message_key"`
	Params       map[string]string `json:"params"`
	DeliveryNote string            `json:"delivery_note"`
}

func (r productFulfillmentCallbackRequest) event(step, status string) model.ProductFulfillmentEvent {
	if r.MessageKey != "" {
		return model.NewProductFulfillmentEvent(step, status, r.MessageKey, r.Params)
	}
	return model.NewProductFulfillmentEvent(step, status, r.Message, nil)
}

// ProductFulfillmentCallback receives the fulfiller's progress and result.
// It is signed with the shared secret instead of a user session.
func ProductFulfillmentCallback(c *gin.Context) {
	config, err := service.LoadProductFulfillerConfig()
	if err != nil || len(config.Secret) < service.ProductFulfillerSecretMinLength {
		c.JSON(http.StatusNotFound, gin.H{"success": false})
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false})
		return
	}
	if !service.VerifyProductFulfillerSignature(config.Secret,
		c.GetHeader(service.ProductFulfillerTimestampHeader),
		c.GetHeader(service.ProductFulfillerSignatureHeader),
		body, time.Now()) {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false})
		return
	}
	var req productFulfillmentCallbackRequest
	if err := common.Unmarshal(body, &req); err != nil || req.TradeNo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false})
		return
	}

	if req.Type == productFulfillmentCallbackProgress {
		if req.AttemptId <= 0 || !slices.Contains(model.ProductFulfillmentSteps, req.Step) || !model.IsProductFulfillmentEventStatus(req.Status) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false})
			return
		}
		err := model.RecordProductFulfillmentEvent(req.AttemptId, req.TradeNo, req.event(req.Step, req.Status), "")
		if errors.Is(err, gorm.ErrRecordNotFound) || errors.Is(err, model.ErrProductOrderStatusConflict) {
			c.JSON(http.StatusOK, gin.H{"success": true, "ignored": true})
			return
		}
		if err != nil {
			common.SysError(common.LogText("failed to record payment step %s of product order %s: %s", req.Step, req.TradeNo, err.Error()))
			c.JSON(http.StatusInternalServerError, gin.H{"success": false})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}

	message := truncateRunes(strings.TrimSpace(req.Message), 2000)
	deliveryNote := truncateRunes(strings.TrimSpace(req.DeliveryNote), 5000)
	err = model.FinishProductOrderFulfillment(req.TradeNo, req.AttemptId, req.Success, message, deliveryNote)
	orderChanged := errors.Is(err, model.ErrProductOrderStatusConflict)
	if err != nil && !orderChanged {
		common.SysError(common.LogText("failed to record fulfiller result of product order %s: %s", req.TradeNo, err.Error()))
		c.JSON(http.StatusInternalServerError, gin.H{"success": false})
		return
	}

	attemptId := req.AttemptId
	if attemptId == 0 {
		// A fulfiller without attempt ids: the result belongs to the order's
		// running attempt.
		attemptId, err = model.FindRunningProductFulfillmentAttemptId(req.TradeNo)
		if err != nil {
			common.SysError(common.LogText("failed to record fulfiller result of product order %s: %s", req.TradeNo, err.Error()))
		}
	}
	if attemptId > 0 {
		event := req.event(req.Step, model.ProductFulfillmentStepFailed)
		finalStatus := model.ProductFulfillmentFailed
		if req.Success {
			finalStatus = model.ProductFulfillmentSucceeded
			event = model.NewProductFulfillmentEvent(model.ProductFulfillmentStepComplete, model.ProductFulfillmentStepSucceeded,
				"Order completed and the delivery note saved", nil)
			if orderChanged {
				event = model.NewProductFulfillmentEvent(model.ProductFulfillmentStepComplete, model.ProductFulfillmentStepFailed,
					"Paid, but the order changed meanwhile, so it was not completed automatically", nil)
			}
		}
		err := model.RecordProductFulfillmentEvent(attemptId, req.TradeNo, event, finalStatus)
		if err != nil && !errors.Is(err, model.ErrProductOrderStatusConflict) && !errors.Is(err, gorm.ErrRecordNotFound) {
			common.SysError(common.LogText("failed to record payment step %s of product order %s: %s", event.Step, req.TradeNo, err.Error()))
		}
		// Counted once: a replayed result finds the attempt already ended.
		if err == nil {
			recordPaymentCardOutcome(attemptId, req)
		}
	}

	if orderChanged {
		// Replayed callback, or an admin changed the order meanwhile. The
		// fulfiller must not retry, so this is acknowledged.
		common.SysLog(common.LogText("ignored fulfiller result for product order %s: order is no longer running", req.TradeNo))
		c.JSON(http.StatusOK, gin.H{"success": true, "ignored": true})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// recordPaymentCardOutcome counts the purchase's result on the card that paid.
// A failure without a card_outcome says nothing about the card (an expired
// session, for example), so it is not counted. Failing to count is logged;
// the payment record is already final.
func recordPaymentCardOutcome(attemptId int, req productFulfillmentCallbackRequest) {
	outcome := req.CardOutcome
	if req.Success {
		outcome = model.PaymentCardOutcomeSuccess
	}
	if outcome == "" {
		return
	}
	if err := model.RecordPaymentCardOutcome(attemptId, outcome); err != nil {
		common.SysError(common.LogText("failed to count the result of payment card of attempt %d: %s", attemptId, err.Error()))
	}
}

func truncateRunes(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}
