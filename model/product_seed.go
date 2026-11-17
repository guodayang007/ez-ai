package model

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Each default product has a marker that records it was offered once, so
// deleting it does not bring it back on restart. productDefaultsSeededKey is
// the ChatGPT product's marker; it predates the Claude product.
const (
	productDefaultsSeededKey = "ProductDefaultsSeeded"
	productClaudeSeededKey   = "ProductClaudeSeeded"
)

var errProductDefaultsSeededReadOnly = errors.New("default product markers are managed by the server")

// isProductSeedMarker reports whether key is a marker of a default product.
func isProductSeedMarker(key string) bool {
	return key == productDefaultsSeededKey || key == productClaudeSeededKey
}

// defaultProductTier is one 1-month option of the default catalog.
type defaultProductTier struct {
	name string
	// Prices are in cents to keep the derived amounts exact.
	monthlyCents int64
	// savingCents is the struck-through saving shown next to the price.
	savingCents int64
}

var defaultChatGPTTiers = []defaultProductTier{
	{name: "Go", monthlyCents: 1699, savingCents: 299},
	{name: "Plus", monthlyCents: 4299, savingCents: 299},
	{name: "Pro 100", monthlyCents: 20399, savingCents: 599},
	{name: "Pro 200", monthlyCents: 40599, savingCents: 599},
	{name: "Pro 500", monthlyCents: 102099, savingCents: 1899},
}

func buildDefaultChatGPTProduct() *Product {
	product := &Product{
		Title:       "ChatGPT",
		Subtitle:    "Go / Plus / Pro 官方订阅",
		Icon:        "OpenAI",
		Description: "选择档位后，按提示在 ChatGPT 获取 Session 并粘贴，验证通过即可下单，我们会为该账号开通订阅。",
		Enabled:     true,
		InputFields: []ProductInputField{{
			Key:         "chatgpt_session",
			Label:       "ChatGPT Session",
			Type:        ProductInputChatGPTSession,
			Required:    true,
			Placeholder: `{"user":{...},"expires":"...","accessToken":"..."}`,
			Description: "登录 chatgpt.com 后打开 chatgpt.com/api/auth/session，复制页面全部内容",
		}},
	}
	sortOrder := len(defaultChatGPTTiers)
	for _, tier := range defaultChatGPTTiers {
		product.Skus = append(product.Skus, ProductSku{
			Name:          tier.name + " · 1 个月",
			PriceAmount:   float64(tier.monthlyCents) / 100,
			OriginalPrice: float64(tier.monthlyCents+tier.savingCents) / 100,
			Currency:      "USD",
			Tag:           "自动开通",
			Enabled:       true,
			SortOrder:     sortOrder,
		})
		sortOrder--
	}
	return product
}

var defaultClaudeTiers = []defaultProductTier{
	{name: "Pro", monthlyCents: 4299, savingCents: 299},
	{name: "Max 5x", monthlyCents: 20399, savingCents: 599},
	{name: "Max 20x", monthlyCents: 40599, savingCents: 599},
}

func buildDefaultClaudeProduct() *Product {
	product := &Product{
		Title:       "Claude",
		Subtitle:    "Pro / Max 官方订阅",
		Icon:        "Claude.Color",
		Description: "选择档位后，按提示在 claude.ai 复制 Cookie 并粘贴，验证通过即可下单，我们会为该账号开通订阅。",
		Enabled:     true,
		InputFields: []ProductInputField{{
			Key:         "claude_cookie",
			Label:       "Claude Cookie",
			Type:        ProductInputClaudeCookie,
			Required:    true,
			Placeholder: "sessionKey=sk-ant-sid01-...; lastActiveOrg=...",
			Description: "登录 claude.ai 后，在浏览器开发者工具中复制 Cookie，至少包含 sessionKey",
		}},
	}
	sortOrder := len(defaultClaudeTiers)
	for _, tier := range defaultClaudeTiers {
		product.Skus = append(product.Skus, ProductSku{
			Name:          tier.name + " · 1 个月",
			PriceAmount:   float64(tier.monthlyCents) / 100,
			OriginalPrice: float64(tier.monthlyCents+tier.savingCents) / 100,
			Currency:      "USD",
			Tag:           "自动开通",
			Enabled:       true,
			SortOrder:     sortOrder,
		})
		sortOrder--
	}
	return product
}

// SeedDefaultProducts adds each default product (ChatGPT, Claude) once per
// database. A product is skipped when one with the same title already
// exists, and never re-added after an admin deletes it.
func SeedDefaultProducts() error {
	if err := seedDefaultProductOnce(productDefaultsSeededKey, buildDefaultChatGPTProduct()); err != nil {
		return err
	}
	return seedDefaultProductOnce(productClaudeSeededKey, buildDefaultClaudeProduct())
}

func seedDefaultProductOnce(markerKey string, product *Product) error {
	var marker Option
	err := DB.Where(&Option{Key: markerKey}).First(&marker).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	var count int64
	if err := DB.Model(&Product{}).Where("title = ?", product.Title).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		if err := SaveProduct(product); err != nil {
			return err
		}
	}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).
		Create(&Option{Key: markerKey, Value: "true"}).Error
}
