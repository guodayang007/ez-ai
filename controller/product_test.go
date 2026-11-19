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
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Option{}, &model.SystemTask{}, &model.Product{}, &model.ProductSku{}, &model.ProductOrder{}, &model.ProductFulfillmentAttempt{}, &model.PaymentCard{}))
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

func TestNormalizeClaudeCookie(t *testing.T) {
	const key = "sk-ant-sid01-AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-xyzAA"
	tests := []struct {
		name  string
		value string
		want  string
	}{
		{name: "bare session key", value: "  " + key + "\n", want: "sessionKey=" + key},
		{name: "cookie header keeps other cookies and drops cloudflare ones", value: "Cookie: lastActiveOrg=org-1; cf_clearance=abc; sessionKey=" + key + "; __cf_bm=x", want: "lastActiveOrg=org-1; sessionKey=" + key},
		{name: "malformed pairs are skipped", value: "=x; bad name=1; quoted=\"a b\"; sessionKey=" + key, want: "sessionKey=" + key},
		{name: "header without a session key", value: "lastActiveOrg=org-1; cf_clearance=abc", want: ""},
		{name: "session key of another format", value: "sessionKey=abc123", want: ""},
		{name: "bare value that is not a session key", value: "hello", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, model.NormalizeClaudeCookie(tt.value))
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
	require.Len(t, products, 2)
	byTitle := map[string]model.Product{}
	for _, product := range products {
		byTitle[product.Title] = product
	}
	chatgpt, claude := byTitle["ChatGPT"], byTitle["Claude"]
	require.Len(t, chatgpt.InputFields, 1)
	assert.Equal(t, model.ProductInputChatGPTSession, chatgpt.InputFields[0].Type, "the default ChatGPT product asks for the session")
	require.Len(t, chatgpt.Skus, 5, "only 1-month options are seeded")
	require.Len(t, claude.InputFields, 1)
	assert.Equal(t, model.ProductInputClaudeCookie, claude.InputFields[0].Type, "the default Claude product asks for the cookie")
	assert.True(t, claude.InputFields[0].Required)
	require.Len(t, claude.Skus, 3)
	prices := map[string][2]float64{}
	for _, sku := range append(chatgpt.Skus, claude.Skus...) {
		prices[sku.Name] = [2]float64{sku.PriceAmount, sku.OriginalPrice}
	}
	assert.Equal(t, [2]float64{42.99, 45.98}, prices["Plus · 1 个月"])
	assert.Equal(t, [2]float64{1020.99, 1039.98}, prices["Pro 500 · 1 个月"])
	assert.Equal(t, [2]float64{42.99, 45.98}, prices["Pro · 1 个月"])
	assert.Equal(t, [2]float64{405.99, 411.98}, prices["Max 20x · 1 个月"])

	for _, product := range products {
		require.NoError(t, model.DeleteProduct(product.Id))
	}
	require.NoError(t, model.SeedDefaultProducts())
	products, err = model.ListProducts(false)
	require.NoError(t, err)
	assert.Empty(t, products, "defaults are not re-added after an admin deletes them")
}

func TestSeedDefaultProductsAddsClaudeToAnExistingCatalog(t *testing.T) {
	setupProductTestDB(t)
	// A database seeded before the Claude product existed.
	require.NoError(t, model.DB.Create(&model.Option{Key: "ProductDefaultsSeeded", Value: "true"}).Error)
	require.NoError(t, model.SaveProduct(&model.Product{Title: "Gemini", Enabled: true, Skus: []model.ProductSku{{Name: "monthly", Currency: "USD", Enabled: true}}}))

	require.NoError(t, model.SeedDefaultProducts())
	require.NoError(t, model.SeedDefaultProducts())
	products, err := model.ListProducts(false)
	require.NoError(t, err)
	titles := []string{}
	for _, product := range products {
		titles = append(titles, product.Title)
	}
	assert.ElementsMatch(t, []string{"Gemini", "Claude"}, titles, "Claude is added once; ChatGPT, already offered, is not")
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
	}
}

func testPtr[T any](value T) *T { return &value }

// addPaymentCard puts a usable card into the pool, as the card page does.
func addPaymentCard(t *testing.T, label string, number string) *model.PaymentCard {
	t.Helper()
	card, err := service.CreatePaymentCard(service.PaymentCardInput{
		Label:    testPtr(label),
		Provider: testPtr("dogpay"),
		Number:   testPtr(number),
		Expiry:   testPtr("12/30"),
		CVC:      testPtr("123"),
		Holder:   testPtr("Test Holder"),
		Enabled:  testPtr(true),
	})
	require.NoError(t, err)
	return card
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
		name     string
		key      string
		config   *service.ProductFulfillerConfig
		withCard bool
		want     string
	}{
		{name: "no encryption key", want: `{"status":"key_missing","plans":[],"claude_plans":[],"service_url":"","missing":[]}`},
		{name: "nothing saved", key: productTestEncryptionKey, want: `{"status":"not_configured","plans":[],"claude_plans":[],"service_url":"","missing":["url","secret","plans","cards"]}`},
		{name: "no card in the pool", key: productTestEncryptionKey, config: new(completeProductFulfillerConfig(fulfiller.URL, secret)), want: `{"status":"not_configured","plans":[],"claude_plans":[],"service_url":"` + fulfiller.URL + `","missing":["cards"]}`},
		{name: "saved under another key", key: "another-config-encryption-key-0123456789", config: new(completeProductFulfillerConfig(fulfiller.URL, secret)), withCard: true, want: `{"status":"config_unreadable","plans":[],"claude_plans":[],"service_url":"","missing":[]}`},
		{name: "service not running", key: productTestEncryptionKey, config: new(completeProductFulfillerConfig(stoppedURL, secret)), withCard: true, want: `{"status":"unreachable","plans":[],"claude_plans":[],"service_url":"` + stoppedURL + `","missing":[]}`},
		{name: "secret differs from the service", key: productTestEncryptionKey, config: new(completeProductFulfillerConfig(fulfiller.URL, strings.Repeat("x", 32))), withCard: true, want: `{"status":"unauthorized","plans":[],"claude_plans":[],"service_url":"` + fulfiller.URL + `","missing":[]}`},
		{name: "ready", key: productTestEncryptionKey, config: new(completeProductFulfillerConfig(fulfiller.URL, secret)), withCard: true, want: `{"status":"ok","plans":["chatgptplusplan"],"claude_plans":["claude_pro","claude_max_5x","claude_max_20x"],"service_url":"` + fulfiller.URL + `","missing":[]}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			useProductFulfillerConfig(t, service.ProductFulfillerConfig{})
			system_setting.ProductFulfillerConfig = ""
			require.NoError(t, model.DB.Where("1 = 1").Delete(&model.PaymentCard{}).Error)
			if tt.config != nil {
				require.NoError(t, service.SaveProductFulfillerConfig(*tt.config))
			}
			if tt.withCard {
				addPaymentCard(t, "DogPay #1", "4242424242424242")
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
		"billing":{"country":"us","currency":"usd","city":"Austin"}}`)
	require.True(t, saved.Success, saved.Message)
	var view map[string]any
	require.NoError(t, common.Unmarshal(saved.Data, &view))
	assert.Equal(t, "http://127.0.0.1:3100", view["url"])
	assert.Equal(t, []any{"chatgptplusplan", "chatgptproplan"}, view["plans"])
	assert.Equal(t, true, view["has_secret"])
	assert.Equal(t, map[string]any{"country": "US", "currency": "USD", "line1": "", "city": "Austin", "state": "", "postal_code": ""}, view["billing"])
	assert.NotContains(t, string(saved.Data), secret, "the secret is never sent back")

	var stored model.Option
	require.NoError(t, model.DB.Where(&model.Option{Key: system_setting.ProductFulfillerConfigOption}).First(&stored).Error)
	assert.True(t, strings.HasPrefix(stored.Value, "enc:v1:"))
	for _, plain := range []string{secret, "chatgptplusplan", "Austin"} {
		assert.NotContains(t, stored.Value, plain, "the database holds no plain text")
	}

	// Leaving the secret out keeps it.
	kept := callProductHandler(t, AdminUpdateProductFulfillmentConfig, 1, 0, `{
		"url":"http://127.0.0.1:3100","plans":["chatgptplusplan"]}`)
	require.True(t, kept.Success, kept.Message)
	config, err := service.LoadProductFulfillerConfig()
	require.NoError(t, err)
	assert.Equal(t, secret, config.Secret)

	// The purchase proxy is stored encrypted with the settings, its password is
	// never sent back, and leaving it out keeps the saved proxy.
	proxied := callProductHandler(t, AdminUpdateProductFulfillmentConfig, 1, 0, `{
		"plans":["chatgptplusplan"],"proxy":{"type":"SOCKS5","host":"us.proxy.example","port":1080,"username":"buyer","password":"proxy-pass"}}`)
	require.True(t, proxied.Success, proxied.Message)
	assert.Contains(t, string(proxied.Data), `"has_password":true`)
	assert.NotContains(t, string(proxied.Data), "proxy-pass", "the proxy password is never sent back")
	var proxyStored model.Option
	require.NoError(t, model.DB.Where(&model.Option{Key: system_setting.ProductFulfillerConfigOption}).First(&proxyStored).Error)
	assert.NotContains(t, proxyStored.Value, "proxy-pass", "the database holds no plain proxy password")
	assert.NotContains(t, proxyStored.Value, "us.proxy.example", "the database holds no plain proxy host")
	kept = callProductHandler(t, AdminUpdateProductFulfillmentConfig, 1, 0, `{"plans":["chatgptplusplan"]}`)
	require.True(t, kept.Success, kept.Message)
	config, err = service.LoadProductFulfillerConfig()
	require.NoError(t, err)
	assert.Equal(t, service.ProductFulfillerProxy{Type: "socks5", Host: "us.proxy.example", Port: 1080, Username: "buyer", Password: "proxy-pass"}, config.Proxy)
	badProxy := callProductHandler(t, AdminUpdateProductFulfillmentConfig, 1, 0, `{"plans":[],"proxy":{"type":"vpn","host":"h","port":1080}}`)
	assert.Equal(t, "The proxy type must be http, https, socks5 or ssh", badProxy.Message)
	noHost := callProductHandler(t, AdminUpdateProductFulfillmentConfig, 1, 0, `{"plans":[],"proxy":{"type":"http","host":"","port":1080}}`)
	assert.Equal(t, "The proxy needs a host and a port between 1 and 65535", noHost.Message)

	invalid := callProductHandler(t, AdminUpdateProductFulfillmentConfig, 1, 0, `{"url":"ftp://fulfiller","plans":[]}`)
	assert.Equal(t, "Provide a valid URL starting with http:// or https://", invalid.Message)
	unchanged, err := service.LoadProductFulfillerConfig()
	require.NoError(t, err)
	assert.Equal(t, config, unchanged, "a rejected save keeps the stored settings")

	// Cards are stored in the pool, encrypted, and never returned with their numbers.
	cardBody := `{"label":"DogPay #1","provider":"dogpay","number":"4242 4242 4242 4242","expiry":"12/30","cvc":"123","holder":"Test Holder","enabled":true}`
	added := callProductHandler(t, AdminCreatePaymentCard, 1, 0, cardBody)
	require.True(t, added.Success, added.Message)
	assert.NotContains(t, string(added.Data), "4242424242424242", "the card number is never sent back")
	assert.NotContains(t, string(added.Data), "123", "the CVC is never sent back")
	var addedView map[string]any
	require.NoError(t, common.Unmarshal(added.Data, &addedView))
	assert.Equal(t, "4242", addedView["last4"])
	assert.Equal(t, "visa", addedView["brand"])
	assert.Equal(t, "ready", addedView["status"])
	var storedCard model.PaymentCard
	require.NoError(t, model.DB.First(&storedCard).Error)
	assert.True(t, strings.HasPrefix(storedCard.NumberEncrypted, "enc:v1:"))
	assert.NotContains(t, storedCard.NumberEncrypted, "4242424242424242", "the database holds no plain card number")
	assert.NotContains(t, storedCard.CVCEncrypted, "123")

	duplicate := callProductHandler(t, AdminCreatePaymentCard, 1, 0, cardBody)
	assert.Equal(t, "This card is already in the pool", duplicate.Message)
	tooShort := callProductHandler(t, AdminCreatePaymentCard, 1, 0, `{"label":"x","provider":"dogpay","number":"1234","expiry":"12/30","cvc":"123","holder":"H"}`)
	assert.Equal(t, "The card number must be 12-19 digits", tooShort.Message)
	badProvider := callProductHandler(t, AdminCreatePaymentCard, 1, 0, `{"label":"x","provider":"stripe","number":"5555555555554444","expiry":"12/30","cvc":"123","holder":"H"}`)
	assert.Equal(t, "The provider must be dogpay, virtual, physical or other", badProvider.Message)
	disabled := callProductHandler(t, AdminUpdatePaymentCard, 1, storedCard.Id, `{"enabled":false}`)
	require.True(t, disabled.Success, disabled.Message)
	assert.Contains(t, string(disabled.Data), `"status":"disabled"`)
	relabelled := callProductHandler(t, AdminUpdatePaymentCard, 1, storedCard.Id, `{"enabled":true,"label":"Renamed"}`)
	require.True(t, relabelled.Success, relabelled.Message)
	assert.Contains(t, string(relabelled.Data), `"label":"Renamed"`)
	assert.Contains(t, string(relabelled.Data), `"status":"ready"`)

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
	card := addPaymentCard(t, "DogPay #1", "4242424242424242")

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
	assert.Equal(t, card.Id, running.PaymentCardId, "the payment record names the card that pays")
	assert.Equal(t, "DogPay #1 •••• 4242", running.PaymentCardLabel, "the record keeps the card's label and last four digits")
	assert.Equal(t, service.ProductFulfillmentJob{
		TradeNo:     order.TradeNo,
		AttemptId:   running.Id,
		Provider:    service.ProductFulfillmentProviderChatGPT,
		Plan:        "chatgptplusplan",
		AccessToken: token,
		CallbackURL: "https://ez-ai.test/api/product/fulfillment/callback",
		Card:        service.ProductFulfillerCard{Number: "4242424242424242", Expiry: "12/30", CVC: "123", Holder: "Test Holder"},
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
		`,"success":false,"card_outcome":"declined","step":"confirm_payment","message":"Checkout rejected the payment: declined","message_key":"Checkout rejected the payment: {{reason}}","params":{"reason":"declined"}}`
	assert.Equal(t, http.StatusOK, callback(failed, true))
	stored, err = model.GetProductOrder(order.Id)
	require.NoError(t, err)
	assert.Equal(t, model.ProductFulfillmentFailed, stored.FulfillmentStatus)
	assert.Equal(t, "Checkout rejected the payment: declined", stored.FulfillmentMessage)
	declined, err := model.GetPaymentCard(card.Id)
	require.NoError(t, err)
	assert.False(t, declined.Enabled, "a declined card is switched off until an admin turns it on again")
	assert.Equal(t, model.PaymentCardDisabledDeclined, declined.DisabledReason)
	assert.Equal(t, 0, declined.LeasedAttemptId, "the card is released when the attempt ends")
	assert.Equal(t, 1, declined.SuccessCount, "the earlier successful purchase is counted")
	assert.Equal(t, 1, declined.FailCount)
	last := attempts(order.Id)[0]
	assert.Equal(t, model.ProductFulfillmentFailed, last.Status)
	assert.Equal(t, model.ProductFulfillmentStepConfirm, last.CurrentStep)
	confirm := stepOf(last, model.ProductFulfillmentStepConfirm)
	assert.Equal(t, model.ProductFulfillmentStepFailed, confirm.Status)
	assert.Equal(t, "Checkout rejected the payment: {{reason}}", confirm.Message)
	assert.Equal(t, model.ProductFulfillmentStepPending, stepOf(last, model.ProductFulfillmentStepComplete).Status, "steps after the failure did not run")
	assert.NotEmpty(t, last.Events)

	// A Claude order is paid with the buyer's cookie and a Claude plan.
	const sessionKey = "sk-ant-sid01-AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-xyzAA"
	claude := &model.Product{
		Title:       "Claude",
		Enabled:     true,
		InputFields: []model.ProductInputField{{Key: "cookie", Label: "Claude Cookie", Type: model.ProductInputClaudeCookie, Required: true}},
		Skus:        []model.ProductSku{{Name: "Max 5x", PriceAmount: 203.99, Currency: "USD", Enabled: true}},
	}
	msg, _ = normalizeProduct(claude)
	require.Empty(t, msg)
	require.NoError(t, model.SaveProduct(claude))
	claudeOrderBody := func(cookie string) string {
		inputs, err := common.Marshal(map[string]string{"cookie": cookie})
		require.NoError(t, err)
		return `{"sku_id":` + strconv.Itoa(claude.Skus[0].Id) + `,"inputs":` + string(inputs) + `}`
	}
	badCookie := callProductHandler(t, CreateProductOrder, 7, 0, claudeOrderBody("lastActiveOrg=org-1"))
	assert.Equal(t, "The cookie must contain the sessionKey copied from claude.ai", badCookie.Message)
	placed := callProductHandler(t, CreateProductOrder, 7, 0, claudeOrderBody("cf_clearance=abc; sessionKey="+sessionKey+"; lastActiveOrg=org-1"))
	require.True(t, placed.Success, placed.Message)
	var claudeOrder model.ProductOrder
	require.NoError(t, common.Unmarshal(placed.Data, &claudeOrder))
	assert.NotContains(t, claudeOrder.Inputs["cookie"], sessionKey, "the buyer sees the cookie masked")

	chatgptPlan := callProductHandler(t, AdminExecuteProductOrderPayment, 1, claudeOrder.Id, payPlus)
	assert.Equal(t, "The fulfillment service does not offer this plan", chatgptPlan.Message, "a Claude order only takes Claude plans")
	// The declined card is skipped, so the admin's second card pays.
	second := addPaymentCard(t, "DogPay #2", "5555555555554444")
	paid := callProductHandler(t, AdminExecuteProductOrderPayment, 1, claudeOrder.Id, `{"plan":"claude_max_5x"}`)
	require.True(t, paid.Success, paid.Message)
	assert.Equal(t, second.Id, attempts(claudeOrder.Id)[0].PaymentCardId, "a declined card is not used again")
	claudeJob := received[len(received)-1]
	assert.Equal(t, service.ProductFulfillmentProviderClaude, claudeJob.Provider)
	assert.Equal(t, "claude_max_5x", claudeJob.Plan)
	assert.Equal(t, "sessionKey="+sessionKey+"; lastActiveOrg=org-1", claudeJob.Cookie, "the cookie is sent without Cloudflare cookies")
	assert.Empty(t, claudeJob.AccessToken)
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

// TestPaymentCardPoolChoosesAndHoldsCards covers which card pays: a random
// usable card, a card held by a running purchase is skipped, and the card is
// free again once the purchase ends.
func TestPaymentCardPoolChoosesAndHoldsCards(t *testing.T) {
	setupProductTestDB(t)
	useProductFulfillerConfig(t, service.ProductFulfillerConfig{})
	now := time.Now()

	first := addPaymentCard(t, "first", "4242424242424242")
	second := addPaymentCard(t, "second", "5555555555554444")
	disabledCard := addPaymentCard(t, "off", "6011111111111117")
	require.NoError(t, model.UpdatePaymentCard(disabledCard.Id, map[string]any{"enabled": false}))
	expired := addPaymentCard(t, "old", "4111111111111111")
	require.NoError(t, model.UpdatePaymentCard(expired.Id, map[string]any{"expiry_year": now.Year() - 1}))

	attemptA := model.ProductFulfillmentAttempt{TradeNo: "PO-A", Status: model.ProductFulfillmentRunning, StepsJSON: "[]"}
	attemptB := model.ProductFulfillmentAttempt{TradeNo: "PO-B", Status: model.ProductFulfillmentRunning, StepsJSON: "[]"}
	require.NoError(t, model.DB.Create(&attemptA).Error)
	require.NoError(t, model.DB.Create(&attemptB).Error)

	picked, err := model.LeasePaymentCard(attemptA.Id, 0, now)
	require.NoError(t, err)
	assert.Contains(t, []int{first.Id, second.Id}, picked.Id, "a random usable card pays")
	other := second.Id
	if picked.Id == second.Id {
		other = first.Id
	}
	picked, err = model.LeasePaymentCard(attemptB.Id, 0, now)
	require.NoError(t, err)
	assert.Equal(t, other, picked.Id, "a card held by another purchase is skipped")

	_, err = model.LeasePaymentCard(attemptB.Id, other, now)
	assert.ErrorIs(t, err, model.ErrPaymentCardUnavailable, "a chosen card that is in use is refused")
	_, err = model.LeasePaymentCard(attemptB.Id, disabledCard.Id, now)
	assert.ErrorIs(t, err, model.ErrPaymentCardUnavailable, "a switched-off card is refused")
	_, err = model.LeasePaymentCard(attemptB.Id, expired.Id, now)
	assert.ErrorIs(t, err, model.ErrPaymentCardUnavailable, "an expired card is refused")
	assert.ErrorIs(t, model.DeletePaymentCard(other), model.ErrPaymentCardInUse, "a card paying for an order cannot be deleted")

	// Ending attempt B frees its card; the next purchase can choose it again.
	require.NoError(t, model.RecordProductFulfillmentEvent(attemptB.Id, attemptB.TradeNo,
		model.NewProductFulfillmentEvent(model.ProductFulfillmentStepComplete, model.ProductFulfillmentStepSucceeded, "done", nil),
		model.ProductFulfillmentSucceeded))
	released, err := model.GetPaymentCard(other)
	require.NoError(t, err)
	assert.Equal(t, 0, released.LeasedAttemptId)
	assert.Equal(t, model.PaymentCardStatusReady, released.Status(now))
	picked, err = model.LeasePaymentCard(attemptB.Id, other, now)
	require.NoError(t, err)
	assert.Equal(t, other, picked.Id)
}

// TestLegacyFulfillerCardMovesIntoThePool moves the card an older version kept
// in the fulfiller settings into the pool, once.
func TestLegacyFulfillerCardMovesIntoThePool(t *testing.T) {
	setupProductTestDB(t)
	useProductFulfillerConfig(t, service.ProductFulfillerConfig{})
	const secret = "0123456789abcdef0123456789abcdef"
	legacy := `{"url":"http://127.0.0.1:3100","secret":"` + secret + `","plans":["chatgptplusplan"],` +
		`"card":{"number":"4242424242424242","expiry":"12/30","cvc":"123","holder":"Test Holder"}}`
	sealed, err := common.EncryptConfigValue([]byte(legacy))
	require.NoError(t, err)
	system_setting.ProductFulfillerConfig = sealed

	require.NoError(t, service.ImportLegacyProductFulfillerCard())
	cards, err := model.ListPaymentCards()
	require.NoError(t, err)
	require.Len(t, cards, 1)
	assert.Equal(t, "DogPay", cards[0].Label)
	assert.Equal(t, "4242", cards[0].Last4)

	config, err := service.LoadProductFulfillerConfig()
	require.NoError(t, err)
	assert.Equal(t, secret, config.Secret, "the other settings are kept")
	var rewritten map[string]any
	plaintext, err := common.DecryptConfigValue(system_setting.ProductFulfillerConfig)
	require.NoError(t, err)
	require.NoError(t, common.Unmarshal(plaintext, &rewritten))
	assert.NotContains(t, rewritten, "card", "the settings no longer hold the card")

	// A second start finds nothing to move and does not duplicate the card.
	require.NoError(t, service.ImportLegacyProductFulfillerCard())
	count, err := model.CountPaymentCards()
	require.NoError(t, err)
	assert.EqualValues(t, 1, count)
}
