package controller

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type productTestResponse struct {
	Success bool            `json:"success"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func setupProductTestDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Option{}, &model.Product{}, &model.ProductSku{}, &model.ProductOrder{}))
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })
}

func callProductHandler(t *testing.T, handler gin.HandlerFunc, userId int, id int, body string) productTestResponse {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("id", userId)
	if id > 0 {
		c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(id)}}
	}
	handler(c)
	var resp productTestResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &resp))
	return resp
}

func TestValidateProductOrderInputs(t *testing.T) {
	fields := []model.ProductInputField{
		{Key: "redeem_code", Label: "Redeem Code", Type: model.ProductInputSecret, Required: true, MaxLength: 16},
		{Key: "config", Label: "Config", Type: model.ProductInputJSON},
		{Key: "cookie_file", Label: "Cookie File", Type: model.ProductInputBase64},
	}
	tests := []struct {
		name      string
		submitted map[string]string
		wantMsg   string
		wantInput map[string]string
	}{
		{
			name:      "valid values are trimmed, base64 whitespace removed, unknown keys dropped",
			submitted: map[string]string{"redeem_code": "  sk-123  ", "config": `{"a":1}`, "cookie_file": "aGVs\nbG8=", "extra": "x"},
			wantInput: map[string]string{"redeem_code": "sk-123", "config": `{"a":1}`, "cookie_file": "aGVsbG8="},
		},
		{name: "missing required field", submitted: map[string]string{"config": "{}"}, wantMsg: "{{field}} is required"},
		{name: "value longer than max length", submitted: map[string]string{"redeem_code": "01234567890123456"}, wantMsg: "{{field}} cannot exceed {{max}} characters"},
		{name: "invalid json", submitted: map[string]string{"redeem_code": "sk", "config": "{bad"}, wantMsg: "{{field}} must be valid JSON"},
		{name: "invalid base64", submitted: map[string]string{"redeem_code": "sk", "cookie_file": "***"}, wantMsg: "{{field}} must be valid Base64"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inputs, msg, _ := validateProductOrderInputs(fields, tt.submitted)
			assert.Equal(t, tt.wantMsg, msg)
			if tt.wantMsg == "" {
				assert.Equal(t, tt.wantInput, inputs)
			}
		})
	}
}

func TestValidateChatGPTSession(t *testing.T) {
	now := time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC)
	const token = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl"
	tests := []struct {
		name    string
		value   string
		wantMsg string
	}{
		{name: "valid session", value: `{"user":{"email":"a@b.c"},"expires":"2026-12-01T00:00:00.000Z","accessToken":"` + token + `"}`},
		{name: "valid session without expires", value: `{"accessToken":"` + token + `"}`},
		{name: "plain token is not the session json", value: token, wantMsg: "The session must be the full JSON copied from the ChatGPT session page"},
		{name: "broken json", value: `{"accessToken":`, wantMsg: "The session must be the full JSON copied from the ChatGPT session page"},
		{name: "signed out page returns empty object", value: `{}`, wantMsg: "The session has no access token, please sign in to ChatGPT and copy it again"},
		{name: "access token is not a jwt", value: `{"accessToken":"abc"}`, wantMsg: "The session has no access token, please sign in to ChatGPT and copy it again"},
		{name: "expired session", value: `{"expires":"2026-11-01T00:00:00Z","accessToken":"` + token + `"}`, wantMsg: "The session has expired, please refresh the ChatGPT session page and copy it again"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.wantMsg, validateChatGPTSession(tt.value, now))
		})
	}
}

func TestProductOrderLifecycle(t *testing.T) {
	setupProductTestDB(t)
	product := &model.Product{
		Title:       "ChatGPT Plus",
		Enabled:     true,
		InputFields: []model.ProductInputField{{Key: "redeem_code", Label: "Redeem Code", Type: model.ProductInputSecret, Required: true}},
		Skus: []model.ProductSku{
			{Name: "1 month", PriceAmount: 20, Currency: "USD", Enabled: true},
			{Name: "Pro · 1 month", PriceAmount: 55, Currency: "USD", Enabled: true},
		},
	}
	msg, _ := normalizeProduct(product)
	require.Empty(t, msg)
	require.NoError(t, model.SaveProduct(product))
	skuId := product.Skus[0].Id

	missingField := callProductHandler(t, CreateProductOrder, 7, 0, `{"sku_id":`+strconv.Itoa(product.Skus[1].Id)+`}`)
	assert.False(t, missingField.Success, "every SKU requires the product's order fields")

	created := callProductHandler(t, CreateProductOrder, 7, 0, `{"sku_id":`+strconv.Itoa(skuId)+`,"inputs":{"redeem_code":"code-abcdefghijkl"}}`)
	require.True(t, created.Success, created.Message)
	var order model.ProductOrder
	require.NoError(t, common.Unmarshal(created.Data, &order))
	assert.Equal(t, model.ProductOrderPending, order.Status)
	assert.Equal(t, "code********ijkl", order.Inputs["redeem_code"], "buyer response masks secret values")

	stored, err := model.GetProductOrder(order.Id)
	require.NoError(t, err)
	assert.Equal(t, "code-abcdefghijkl", stored.Inputs["redeem_code"], "admin view keeps the full value")
	require.Len(t, stored.InputFields, 1, "the order snapshots the product's order fields")
	assert.Equal(t, "redeem_code", stored.InputFields[0].Key)

	otherUser := callProductHandler(t, CancelSelfProductOrder, 8, order.Id, "")
	assert.False(t, otherUser.Success, "a user cannot cancel someone else's order")

	toProcessing := callProductHandler(t, AdminUpdateProductOrder, 1, order.Id, `{"status":"processing"}`)
	require.True(t, toProcessing.Success, toProcessing.Message)

	cancelLate := callProductHandler(t, CancelSelfProductOrder, 7, order.Id, "")
	assert.False(t, cancelLate.Success, "only pending orders can be cancelled by the buyer")

	completed := callProductHandler(t, AdminUpdateProductOrder, 1, order.Id, `{"status":"completed","delivery_note":"done"}`)
	require.True(t, completed.Success, completed.Message)
	stored, err = model.GetProductOrder(order.Id)
	require.NoError(t, err)
	assert.Equal(t, model.ProductOrderCompleted, stored.Status)
	assert.Equal(t, "done", stored.DeliveryNote)
	assert.Positive(t, stored.CompletedAt)

	backwards := callProductHandler(t, AdminUpdateProductOrder, 1, order.Id, `{"status":"processing"}`)
	assert.False(t, backwards.Success, "a completed order cannot move back")
}

func TestCreateProductOrderRejectsDisabledProduct(t *testing.T) {
	setupProductTestDB(t)
	product := &model.Product{Title: "Gemini", Enabled: true, Skus: []model.ProductSku{{Name: "monthly", Currency: "USD", Enabled: true}}}
	require.NoError(t, model.SaveProduct(product))
	require.NoError(t, model.SetProductEnabled(product.Id, false))

	resp := callProductHandler(t, CreateProductOrder, 7, 0, `{"sku_id":`+strconv.Itoa(product.Skus[0].Id)+`}`)
	assert.False(t, resp.Success)
	assert.Equal(t, "This product is not available", resp.Message)
}

func TestSeedDefaultProductsRunsOnce(t *testing.T) {
	setupProductTestDB(t)
	require.NoError(t, model.SeedDefaultProducts())

	products, err := model.ListProducts(false)
	require.NoError(t, err)
	require.Len(t, products, 1)
	assert.Equal(t, "ChatGPT", products[0].Title)
	require.Len(t, products[0].InputFields, 1)
	assert.Equal(t, model.ProductInputChatGPTSession, products[0].InputFields[0].Type, "the default ChatGPT product asks for the session")
	require.Len(t, products[0].Skus, 5, "only 1-month options are seeded")
	prices := map[string][2]float64{}
	for _, sku := range products[0].Skus {
		prices[sku.Name] = [2]float64{sku.PriceAmount, sku.OriginalPrice}
	}
	assert.Equal(t, [2]float64{42.99, 45.98}, prices["Plus · 1 个月"])
	assert.Equal(t, [2]float64{1020.99, 1039.98}, prices["Pro 500 · 1 个月"])

	require.NoError(t, model.DeleteProduct(products[0].Id))
	require.NoError(t, model.SeedDefaultProducts())
	products, err = model.ListProducts(false)
	require.NoError(t, err)
	assert.Empty(t, products, "defaults are not re-added after an admin deletes them")
}

func TestNormalizeProductRejectsOriginalPriceBelowPrice(t *testing.T) {
	product := &model.Product{Title: "Plus", Skus: []model.ProductSku{{Name: "1 month", PriceAmount: 20, OriginalPrice: 10}}}
	msg, _ := normalizeProduct(product)
	assert.Equal(t, "Original price cannot be lower than the price", msg)
}

func TestProductOrderAutomaticFulfillment(t *testing.T) {
	setupProductTestDB(t)
	const secret = "0123456789abcdef0123456789abcdef"
	const token = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl"
	var received []service.ProductFulfillmentJob
	rejectJobs := false
	fulfiller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		assert.True(t, service.VerifyProductFulfillerSignature(secret,
			r.Header.Get(service.ProductFulfillerTimestampHeader),
			r.Header.Get(service.ProductFulfillerSignatureHeader), body, time.Now()),
			"requests sent to the fulfiller are signed")
		if r.Method == http.MethodGet && r.URL.Path == "/v1/plans" {
			_, _ = w.Write([]byte(`{"plans":["chatgptplusplan","chatgptpro"]}`))
			return
		}
		var job service.ProductFulfillmentJob
		require.NoError(t, common.Unmarshal(body, &job))
		received = append(received, job)
		if rejectJobs {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer fulfiller.Close()
	t.Setenv("PRODUCT_FULFILLER_URL", fulfiller.URL)
	t.Setenv("PRODUCT_FULFILLER_SECRET", secret)
	t.Setenv("PRODUCT_FULFILLER_CALLBACK_URL", "https://ez-ai.test/api/product/fulfillment/callback")

	product := &model.Product{
		Title:       "ChatGPT",
		Enabled:     true,
		InputFields: []model.ProductInputField{{Key: "session", Label: "Session", Type: model.ProductInputChatGPTSession, Required: true}},
		Skus: []model.ProductSku{
			{Name: "Plus", PriceAmount: 42.99, Currency: "USD", Enabled: true},
		},
	}
	msg, _ := normalizeProduct(product)
	require.Empty(t, msg)
	require.NoError(t, model.SaveProduct(product))
	session := `{"accessToken":"` + token + `"}`
	placeOrder := func(skuId int) model.ProductOrder {
		inputs, err := common.Marshal(map[string]string{"session": session})
		require.NoError(t, err)
		resp := callProductHandler(t, CreateProductOrder, 7, 0, `{"sku_id":`+strconv.Itoa(skuId)+`,"inputs":`+string(inputs)+`}`)
		require.True(t, resp.Success, resp.Message)
		var order model.ProductOrder
		require.NoError(t, common.Unmarshal(resp.Data, &order))
		assert.Empty(t, order.FulfillmentPlan, "buyers do not see the fulfillment plan")
		return order
	}
	callback := func(payload string, sign bool) int {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(payload))
		timestamp := time.Now().Unix()
		c.Request.Header.Set(service.ProductFulfillerTimestampHeader, strconv.FormatInt(timestamp, 10))
		signature := service.SignProductFulfillerPayload(secret, timestamp, []byte(payload))
		if !sign {
			signature = service.SignProductFulfillerPayload("wrong-secret", timestamp, []byte(payload))
		}
		c.Request.Header.Set(service.ProductFulfillerSignatureHeader, signature)
		ProductFulfillmentCallback(c)
		return recorder.Code
	}

	plans := callProductHandler(t, AdminListProductFulfillmentPlans, 1, 0, "")
	require.True(t, plans.Success, plans.Message)
	assert.JSONEq(t, `{"plans":["chatgptplusplan","chatgptpro"]}`, string(plans.Data))

	const payPlus = `{"plan":" chatgptplusplan "}`
	order := placeOrder(product.Skus[0].Id)
	unpaid := callProductHandler(t, AdminExecuteProductOrderPayment, 1, order.Id, payPlus)
	assert.False(t, unpaid.Success, "a pending order is not paid for until the buyer has paid")
	require.True(t, callProductHandler(t, AdminUpdateProductOrder, 1, order.Id, `{"status":"paid"}`).Success)

	noPlan := callProductHandler(t, AdminExecuteProductOrderPayment, 1, order.Id, `{"plan":""}`)
	assert.Equal(t, "Choose a plan to buy", noPlan.Message)
	notOffered := callProductHandler(t, AdminExecuteProductOrderPayment, 1, order.Id, `{"plan":"chatgptteamplan"}`)
	assert.Equal(t, "The fulfillment service does not offer this plan", notOffered.Message)
	stored, err := model.GetProductOrder(order.Id)
	require.NoError(t, err)
	assert.Equal(t, model.ProductOrderPaid, stored.Status, "a rejected plan leaves the order untouched")
	assert.Empty(t, received)

	// The fulfiller is down: the attempt is recorded as failed and can be retried.
	rejectJobs = true
	down := callProductHandler(t, AdminExecuteProductOrderPayment, 1, order.Id, payPlus)
	assert.Equal(t, "The fulfillment service did not accept the order", down.Message)
	stored, err = model.GetProductOrder(order.Id)
	require.NoError(t, err)
	assert.Equal(t, model.ProductOrderProcessing, stored.Status)
	assert.Equal(t, model.ProductFulfillmentFailed, stored.FulfillmentStatus)
	assert.Contains(t, stored.FulfillmentMessage, "HTTP 503")
	assert.Equal(t, "chatgptplusplan", stored.FulfillmentPlan, "the chosen plan is recorded on the order")

	rejectJobs = false
	started := callProductHandler(t, AdminExecuteProductOrderPayment, 1, order.Id, payPlus)
	require.True(t, started.Success, started.Message)
	require.Len(t, received, 2)
	assert.Equal(t, service.ProductFulfillmentJob{
		TradeNo:     order.TradeNo,
		Plan:        "chatgptplusplan",
		AccessToken: token,
		CallbackURL: "https://ez-ai.test/api/product/fulfillment/callback",
	}, received[1])

	again := callProductHandler(t, AdminExecuteProductOrderPayment, 1, order.Id, payPlus)
	assert.False(t, again.Success, "a running purchase cannot be started twice")
	require.Len(t, received, 2, "the card is not charged a second time")

	success := `{"trade_no":"` + order.TradeNo + `","success":true,"delivery_note":"ChatGPT Plus activated"}`
	assert.Equal(t, http.StatusUnauthorized, callback(success, false), "unsigned results are rejected")
	stored, err = model.GetProductOrder(order.Id)
	require.NoError(t, err)
	assert.Equal(t, model.ProductFulfillmentRunning, stored.FulfillmentStatus)

	assert.Equal(t, http.StatusOK, callback(success, true))
	stored, err = model.GetProductOrder(order.Id)
	require.NoError(t, err)
	assert.Equal(t, model.ProductOrderCompleted, stored.Status)
	assert.Equal(t, model.ProductFulfillmentSucceeded, stored.FulfillmentStatus)
	assert.Equal(t, "ChatGPT Plus activated", stored.DeliveryNote)
	assert.Positive(t, stored.CompletedAt)

	failedReplay := `{"trade_no":"` + order.TradeNo + `","success":false,"message":"card declined"}`
	assert.Equal(t, http.StatusOK, callback(failedReplay, true), "late results are acknowledged so the fulfiller stops retrying")
	stored, err = model.GetProductOrder(order.Id)
	require.NoError(t, err)
	assert.Equal(t, model.ProductFulfillmentSucceeded, stored.FulfillmentStatus, "a late result does not overwrite a finished purchase")
}

func TestVerifyProductFulfillerSignature(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef"
	now := time.Unix(1_800_000_000, 0)
	body := []byte(`{"trade_no":"PO1"}`)
	signature := service.SignProductFulfillerPayload(secret, now.Unix(), body)
	// Same vector as services/dogpay-fulfiller/test/app.test.mjs.
	require.Equal(t, "4b15c0aca50b26446c081d40c59fed570b2fc8641345102bd26210eb6577b459", signature)
	tests := []struct {
		name      string
		timestamp int64
		signature string
		body      []byte
		want      bool
	}{
		{name: "valid", timestamp: now.Unix(), signature: signature, body: body, want: true},
		{name: "uppercase hex", timestamp: now.Unix(), signature: strings.ToUpper(signature), body: body, want: true},
		{name: "tampered body", timestamp: now.Unix(), signature: signature, body: []byte(`{"trade_no":"PO2"}`)},
		{name: "stale timestamp", timestamp: now.Add(-6 * time.Minute).Unix(), signature: service.SignProductFulfillerPayload(secret, now.Add(-6*time.Minute).Unix(), body), body: body},
		{name: "empty signature", timestamp: now.Unix(), body: body},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := service.VerifyProductFulfillerSignature(secret, strconv.FormatInt(tt.timestamp, 10), tt.signature, tt.body, now)
			assert.Equal(t, tt.want, got)
		})
	}
}
