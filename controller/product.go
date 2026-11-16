package controller

import (
	"encoding/base64"
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
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
	productInputKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)
	productCurrencyPattern = regexp.MustCompile(`^[A-Z]{3,8}$`)
	productInputTypes      = map[string]bool{
		model.ProductInputText:           true,
		model.ProductInputTextarea:       true,
		model.ProductInputSecret:         true,
		model.ProductInputJSON:           true,
		model.ProductInputBase64:         true,
		model.ProductInputChatGPTSession: true,
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
		}
		totalLength += len(value)
		if totalLength > productInputsTotalMaxLength {
			return nil, "Submitted information is too large", nil
		}
		inputs[field.Key] = value
	}
	return inputs, "", nil
}

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
	order.MaskSecretInputs()
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
		orders[i].MaskSecretInputs()
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
