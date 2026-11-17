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
	"github.com/QuantumNous/new-api/setting/system_setting"
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
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Option{}, &model.SystemTask{}, &model.Product{}, &model.ProductSku{}, &model.ProductOrder{}, &model.ProductFulfillmentAttempt{}))
	model.DB = db
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		model.DB = previousDB
		common.OptionMap = previousOptions
	})
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

const productTestEncryptionKey = "test-config-encryption-key-0123456789"

// useProductFulfillerConfig saves the fulfiller settings encrypted, as the
// settings page does.
func useProductFulfillerConfig(t *testing.T, config service.ProductFulfillerConfig) {
	t.Helper()
	previousKey, previousConfig := common.ConfigEncryptionKey, system_setting.ProductFulfillerConfig
	t.Cleanup(func() {
		common.ConfigEncryptionKey, system_setting.ProductFulfillerConfig = previousKey, previousConfig
	})
	common.ConfigEncryptionKey = productTestEncryptionKey
	require.NoError(t, service.SaveProductFulfillerConfig(config))
}

func completeProductFulfillerConfig(url, secret string) service.ProductFulfillerConfig {
	return service.ProductFulfillerConfig{
		URL:    url,
		Secret: secret,
		Plans:  []string{"chatgptplusplan"},
		Card:   service.ProductFulfillerCard{Number: "4242424242424242", Expiry: "12/30", CVC: "123", Holder: "Test Holder"},
	}
}

func TestProductFulfillmentStatusExplainsSetupProblems(t *testing.T) {
	setupProductTestDB(t)
	const secret = "0123456789abcdef0123456789abcdef"
	fulfiller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/ping" || !service.VerifyProductFulfillerSignature(secret,
			r.Header.Get(service.ProductFulfillerTimestampHeader),
			r.Header.Get(service.ProductFulfillerSignatureHeader), nil, time.Now()) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer fulfiller.Close()
	stopped := httptest.NewServer(http.NotFoundHandler())
	stoppedURL := stopped.URL
	stopped.Close()

	tests := []struct {
		name   string
		key    string
		config *service.ProductFulfillerConfig
		want   string
	}{
		{name: "no encryption key", want: `{"status":"key_missing","plans":[],"service_url":"","missing":[]}`},
		{name: "nothing saved", key: productTestEncryptionKey, want: `{"status":"not_configured","plans":[],"service_url":"","missing":["url","secret","plans","card_number","card_expiry","card_cvc","card_holder"]}`},
		{name: "card missing", key: productTestEncryptionKey, config: &service.ProductFulfillerConfig{URL: fulfiller.URL, Secret: secret, Plans: []string{"chatgptplusplan"}}, want: `{"status":"not_configured","plans":[],"service_url":"` + fulfiller.URL + `","missing":["card_number","card_expiry","card_cvc","card_holder"]}`},
		{name: "saved under another key", key: "another-config-encryption-key-0123456789", config: new(completeProductFulfillerConfig(fulfiller.URL, secret)), want: `{"status":"config_unreadable","plans":[],"service_url":"","missing":[]}`},
		{name: "service not running", key: productTestEncryptionKey, config: new(completeProductFulfillerConfig(stoppedURL, secret)), want: `{"status":"unreachable","plans":[],"service_url":"` + stoppedURL + `","missing":[]}`},
		{name: "secret differs from the service", key: productTestEncryptionKey, config: new(completeProductFulfillerConfig(fulfiller.URL, strings.Repeat("x", 32))), want: `{"status":"unauthorized","plans":[],"service_url":"` + fulfiller.URL + `","missing":[]}`},
		{name: "ready", key: productTestEncryptionKey, config: new(completeProductFulfillerConfig(fulfiller.URL, secret)), want: `{"status":"ok","plans":["chatgptplusplan"],"service_url":"` + fulfiller.URL + `","missing":[]}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			useProductFulfillerConfig(t, service.ProductFulfillerConfig{})
			system_setting.ProductFulfillerConfig = ""
			if tt.config != nil {
				require.NoError(t, service.SaveProductFulfillerConfig(*tt.config))
			}
			common.ConfigEncryptionKey = tt.key

			resp := callProductHandler(t, AdminGetProductFulfillmentStatus, 1, 0, "")
			require.True(t, resp.Success, resp.Message)
			assert.JSONEq(t, tt.want, string(resp.Data))
		})
	}
}

func TestProductFulfillmentConfigIsStoredEncrypted(t *testing.T) {
	setupProductTestDB(t)
	useProductFulfillerConfig(t, service.ProductFulfillerConfig{})
	const secret = "0123456789abcdef0123456789abcdef"

	saved := callProductHandler(t, AdminUpdateProductFulfillmentConfig, 1, 0, `{
		"url":"http://127.0.0.1:3100/","secret":"`+secret+`","plans":["chatgptplusplan"," chatgptplusplan","chatgptproplan"],
		"card_number":"4242 4242 4242 4242","card_expiry":"12/30","card_cvc":"123","card_holder":"Test Holder",
		"billing":{"country":"us","currency":"usd","city":"Austin"},"browser_proxy":"http://user:pass@proxy:8080"}`)
	require.True(t, saved.Success, saved.Message)
	var view map[string]any
	require.NoError(t, common.Unmarshal(saved.Data, &view))
	assert.Equal(t, "http://127.0.0.1:3100", view["url"])
	assert.Equal(t, []any{"chatgptplusplan", "chatgptproplan"}, view["plans"])
	assert.Equal(t, "4242", view["card_last4"])
	assert.Equal(t, true, view["has_secret"])
	assert.Equal(t, true, view["has_card_cvc"])
	assert.Equal(t, true, view["has_browser_proxy"])
	assert.Equal(t, map[string]any{"country": "US", "currency": "USD", "line1": "", "city": "Austin", "state": "", "postal_code": ""}, view["billing"])
	assert.NotContains(t, string(saved.Data), secret, "the secret is never sent back")
	assert.NotContains(t, string(saved.Data), "4242424242424242", "the card number is never sent back")
	assert.NotContains(t, string(saved.Data), "pass@", "the proxy credentials are never sent back")

	var stored model.Option
	require.NoError(t, model.DB.Where(&model.Option{Key: system_setting.ProductFulfillerConfigOption}).First(&stored).Error)
	assert.True(t, strings.HasPrefix(stored.Value, "enc:v1:"))
	for _, plain := range []string{secret, "4242424242424242", "Test Holder", "chatgptplusplan", "Austin"} {
		assert.NotContains(t, stored.Value, plain, "the database holds no plain text")
	}

	// Leaving the secrets out keeps them; an empty proxy clears it.
	kept := callProductHandler(t, AdminUpdateProductFulfillmentConfig, 1, 0, `{
		"url":"http://127.0.0.1:3100","plans":["chatgptplusplan"],"card_expiry":"01/31","card_holder":"Test Holder","browser_proxy":""}`)
	require.True(t, kept.Success, kept.Message)
	config, err := service.LoadProductFulfillerConfig()
	require.NoError(t, err)
	assert.Equal(t, secret, config.Secret)
	assert.Equal(t, service.ProductFulfillerCard{Number: "4242424242424242", Expiry: "01/31", CVC: "123", Holder: "Test Holder"}, config.Card)
	assert.Empty(t, config.BrowserProxy)

	invalid := callProductHandler(t, AdminUpdateProductFulfillmentConfig, 1, 0, `{"card_number":"1234","plans":[]}`)
	assert.Equal(t, "The card number must be 12-19 digits", invalid.Message)
	unchanged, err := service.LoadProductFulfillerConfig()
	require.NoError(t, err)
	assert.Equal(t, config, unchanged, "a rejected save keeps the stored settings")

	for proxy, message := range map[string]string{
		"ftp://proxy:21":                "Provide a valid proxy URL such as http://user:pass@host:port",
		"proxy:8080":                    "Provide a valid proxy URL such as http://user:pass@host:port",
		"socks5://user:pass@proxy:1080": "The browser cannot use a SOCKS5 proxy with a username and password; use an HTTP proxy instead",
	} {
		rejected := callProductHandler(t, AdminUpdateProductFulfillmentConfig, 1, 0, `{"browser_proxy":"`+proxy+`"}`)
		assert.Equal(t, message, rejected.Message, proxy)
	}
	accepted := callProductHandler(t, AdminUpdateProductFulfillmentConfig, 1, 0, `{"browser_proxy":"socks5://proxy:1080"}`)
	require.True(t, accepted.Success, accepted.Message)

	common.ConfigEncryptionKey = ""
	noKey := callProductHandler(t, AdminUpdateProductFulfillmentConfig, 1, 0, `{"plans":[]}`)
	assert.False(t, noKey.Success, "nothing is saved without an encryption key")
}

func TestProductFulfillerPayloadMatchesTheFulfiller(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef"
	// Sealed by ez-ai; services/dogpay-fulfiller/test/app.test.mjs opens the
	// same body.
	body := []byte(`{"sealed":"mLmL6sgh1/dWVrXMLNoh8hp0ZVolvIggRGD2zWRkEN4bIiH5H4W0gdpO8crxNg=="}`)
	plaintext, err := service.OpenProductFulfillerPayload(secret, body)
	require.NoError(t, err)
	assert.Equal(t, `{"trade_no":"PO1"}`, string(plaintext))

	_, err = service.OpenProductFulfillerPayload(strings.Repeat("x", 32), body)
	assert.Error(t, err, "another secret cannot open the job")
}

func TestProductOrderAutomaticFulfillment(t *testing.T) {
	setupProductTestDB(t)
	const secret = "0123456789abcdef0123456789abcdef"
	const token = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl"
	var received []service.ProductFulfillmentJob
	rejectJobs := false
	// Like the real fulfiller, reports its first step before answering.
	var reportQueued func(job service.ProductFulfillmentJob)
	fulfiller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		assert.True(t, service.VerifyProductFulfillerSignature(secret,
			r.Header.Get(service.ProductFulfillerTimestampHeader),
			r.Header.Get(service.ProductFulfillerSignatureHeader), body, time.Now()),
			"requests sent to the fulfiller are signed")
		plaintext, err := service.OpenProductFulfillerPayload(secret, body)
		require.NoError(t, err, "jobs are encrypted with the shared secret")
		assert.NotContains(t, string(body), "4242424242424242", "the card is not sent in plain text")
		var job service.ProductFulfillmentJob
		require.NoError(t, common.Unmarshal(plaintext, &job))
		received = append(received, job)
		if rejectJobs {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		reportQueued(job)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer fulfiller.Close()
	config := completeProductFulfillerConfig(fulfiller.URL, secret)
	config.Plans = []string{"chatgptplusplan", "chatgptpro"}
	config.CallbackURL = "https://ez-ai.test/api/product/fulfillment/callback"
	config.Billing = service.ProductFulfillerBilling{City: "Austin"}
	useProductFulfillerConfig(t, config)

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
	reportQueued = func(job service.ProductFulfillmentJob) {
		progress := `{"type":"progress","trade_no":"` + job.TradeNo + `","attempt_id":` + strconv.Itoa(job.AttemptId) +
			`,"step":"queue","status":"running","message":"Queued, starting now","message_key":"Queued, starting now"}`
		assert.Equal(t, http.StatusOK, callback(progress, true))
	}
	attempts := func(orderId int) []model.ProductFulfillmentAttempt {
		list, err := model.ListProductFulfillmentAttempts(orderId)
		require.NoError(t, err)
		return list
	}
	stepOf := func(attempt model.ProductFulfillmentAttempt, key string) model.ProductFulfillmentStepState {
		for _, step := range attempt.Steps {
			if step.Key == key {
				return step
			}
		}
		t.Fatalf("attempt %d has no step %s", attempt.Id, key)
		return model.ProductFulfillmentStepState{}
	}

	const payPlus = `{"plan":" chatgptplusplan "}`
	// The order stays pending: execute payment does not check the order status.
	order := placeOrder(product.Skus[0].Id)
	noPlan := callProductHandler(t, AdminExecuteProductOrderPayment, 1, order.Id, `{"plan":""}`)
	assert.Equal(t, "Choose a plan to buy", noPlan.Message)
	notOffered := callProductHandler(t, AdminExecuteProductOrderPayment, 1, order.Id, `{"plan":"chatgptteamplan"}`)
	assert.Equal(t, "The fulfillment service does not offer this plan", notOffered.Message)
	stored, err := model.GetProductOrder(order.Id)
	require.NoError(t, err)
	assert.Equal(t, model.ProductOrderPending, stored.Status, "a rejected plan leaves the order untouched")
	assert.Empty(t, received)
	records := attempts(order.Id)
	require.Len(t, records, 1, "a click without a plan is not a payment attempt; a refused plan is")
	assert.Equal(t, model.ProductFulfillmentFailed, records[0].Status)
	assert.Equal(t, model.ProductFulfillmentStepPrepare, records[0].CurrentStep)
	assert.Equal(t, model.ProductFulfillmentStepFailed, stepOf(records[0], model.ProductFulfillmentStepPrepare).Status)
	assert.Equal(t, "The fulfillment service does not offer this plan", stepOf(records[0], model.ProductFulfillmentStepPrepare).Message)
	assert.Equal(t, model.ProductFulfillmentStepPending, stepOf(records[0], model.ProductFulfillmentStepSubmit).Status)

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
	records = attempts(order.Id)
	require.Len(t, records, 2)
	assert.Equal(t, 2, records[0].Seq, "the newest attempt comes first")
	assert.Equal(t, model.ProductFulfillmentFailed, records[0].Status)
	assert.Equal(t, model.ProductFulfillmentStepSucceeded, stepOf(records[0], model.ProductFulfillmentStepPrepare).Status)
	submit := stepOf(records[0], model.ProductFulfillmentStepSubmit)
	assert.Equal(t, model.ProductFulfillmentStepFailed, submit.Status)
	assert.Equal(t, "The fulfillment service did not accept the job: {{error}}", submit.Message)
	assert.Contains(t, submit.Params["error"], "HTTP 503")

	rejectJobs = false
	started := callProductHandler(t, AdminExecuteProductOrderPayment, 1, order.Id, payPlus)
	require.True(t, started.Success, started.Message)
	require.Len(t, received, 2)
	records = attempts(order.Id)
	require.Len(t, records, 3)
	running := records[0]
	assert.Equal(t, model.ProductFulfillmentRunning, running.Status)
	assert.Equal(t, 1, running.OperatorId)
	assert.Equal(t, model.ProductFulfillmentStepQueue, running.CurrentStep, "ez-ai noting the accepted job does not move back past the fulfiller's step")
	assert.Equal(t, model.ProductFulfillmentStepSucceeded, stepOf(running, model.ProductFulfillmentStepSubmit).Status)
	assert.Equal(t, "The fulfillment service accepted the job", stepOf(running, model.ProductFulfillmentStepSubmit).Message)
	assert.Equal(t, model.ProductFulfillmentStepRunning, stepOf(running, model.ProductFulfillmentStepQueue).Status)
	assert.Equal(t, service.ProductFulfillmentJob{
		TradeNo:     order.TradeNo,
		AttemptId:   running.Id,
		Plan:        "chatgptplusplan",
		AccessToken: token,
		CallbackURL: "https://ez-ai.test/api/product/fulfillment/callback",
		Card:        config.Card,
		Billing:     service.ProductFulfillerBilling{Country: "US", Currency: "USD", City: "Austin"},
	}, received[1], "the job carries the card and the billing address with default country and currency")

	again := callProductHandler(t, AdminExecuteProductOrderPayment, 1, order.Id, payPlus)
	assert.Equal(t, "Automatic payment is already running for this order", again.Message, "a running purchase cannot be started twice")
	require.Len(t, received, 2, "the card is not charged a second time")
	assert.Len(t, attempts(order.Id), 3, "a duplicate click is not a new attempt")

	checkout := `{"type":"progress","trade_no":"` + order.TradeNo + `","attempt_id":` + strconv.Itoa(running.Id) +
		`,"step":"checkout","status":"succeeded","message":"Checkout created: https://pay.test/1","message_key":"Checkout created: {{url}}","params":{"url":"https://pay.test/1"}}`
	assert.Equal(t, http.StatusOK, callback(checkout, true))
	unknownStep := strings.Replace(checkout, `"step":"checkout"`, `"step":"pay_twice"`, 1)
	assert.Equal(t, http.StatusBadRequest, callback(unknownStep, true))
	otherOrder := strings.Replace(checkout, order.TradeNo, "PO-other", 1)
	assert.Equal(t, http.StatusOK, callback(otherOrder, true), "progress for another order is acknowledged and dropped")
	running = attempts(order.Id)[0]
	assert.Equal(t, model.ProductFulfillmentStepCheckout, running.CurrentStep)
	assert.Equal(t, model.ProductFulfillmentStepSucceeded, stepOf(running, model.ProductFulfillmentStepQueue).Status, "a later step closes the earlier one")
	assert.Equal(t, map[string]string{"url": "https://pay.test/1"}, stepOf(running, model.ProductFulfillmentStepCheckout).Params)
	assert.Equal(t, model.ProductFulfillmentStepPending, stepOf(running, model.ProductFulfillmentStepFillPayment).Status)

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
	finished := attempts(order.Id)[0]
	assert.Equal(t, model.ProductFulfillmentSucceeded, finished.Status, "a result without an attempt id finishes the running attempt")
	assert.Equal(t, model.ProductFulfillmentStepComplete, finished.CurrentStep)
	assert.Positive(t, finished.FinishedAt)
	for _, step := range finished.Steps {
		assert.Equal(t, model.ProductFulfillmentStepSucceeded, step.Status, step.Key)
	}

	failedReplay := `{"trade_no":"` + order.TradeNo + `","success":false,"message":"card declined"}`
	assert.Equal(t, http.StatusOK, callback(failedReplay, true), "late results are acknowledged so the fulfiller stops retrying")
	stored, err = model.GetProductOrder(order.Id)
	require.NoError(t, err)
	assert.Equal(t, model.ProductFulfillmentSucceeded, stored.FulfillmentStatus, "a late result does not overwrite a finished purchase")
	assert.Equal(t, model.ProductFulfillmentSucceeded, attempts(order.Id)[0].Status, "nor its payment record")

	rerun := callProductHandler(t, AdminExecuteProductOrderPayment, 1, order.Id, payPlus)
	require.True(t, rerun.Success, "a completed order can be paid again: %s", rerun.Message)
	require.Len(t, received, 3)
	records = attempts(order.Id)
	require.Len(t, records, 4, "every attempt is kept separately")
	assert.Equal(t, []int{4, 3, 2, 1}, []int{records[0].Seq, records[1].Seq, records[2].Seq, records[3].Seq})

	stale := `{"trade_no":"` + order.TradeNo + `","attempt_id":` + strconv.Itoa(finished.Id) + `,"success":false,"step":"checkout","message":"declined"}`
	assert.Equal(t, http.StatusOK, callback(stale, true))
	stored, err = model.GetProductOrder(order.Id)
	require.NoError(t, err)
	assert.Equal(t, model.ProductFulfillmentRunning, stored.FulfillmentStatus, "an earlier attempt's result does not finish the new one")

	failed := `{"trade_no":"` + order.TradeNo + `","attempt_id":` + strconv.Itoa(records[0].Id) +
		`,"success":false,"step":"confirm_payment","message":"Checkout rejected the payment: declined","message_key":"Checkout rejected the payment: {{reason}}","params":{"reason":"declined"}}`
	assert.Equal(t, http.StatusOK, callback(failed, true))
	stored, err = model.GetProductOrder(order.Id)
	require.NoError(t, err)
	assert.Equal(t, model.ProductFulfillmentFailed, stored.FulfillmentStatus)
	assert.Equal(t, "Checkout rejected the payment: declined", stored.FulfillmentMessage)
	last := attempts(order.Id)[0]
	assert.Equal(t, model.ProductFulfillmentFailed, last.Status)
	assert.Equal(t, model.ProductFulfillmentStepConfirm, last.CurrentStep)
	confirm := stepOf(last, model.ProductFulfillmentStepConfirm)
	assert.Equal(t, model.ProductFulfillmentStepFailed, confirm.Status)
	assert.Equal(t, "Checkout rejected the payment: {{reason}}", confirm.Message)
	assert.Equal(t, model.ProductFulfillmentStepPending, stepOf(last, model.ProductFulfillmentStepComplete).Status, "steps after the failure did not run")
	assert.NotEmpty(t, last.Events)
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
