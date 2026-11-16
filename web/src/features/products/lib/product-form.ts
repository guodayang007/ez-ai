/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { TFunction } from 'i18next'
import { z } from 'zod'

import type {
  Product,
  ProductInputField,
  ProductPayload,
  ProductSku,
} from '../types'

export const PRODUCT_INPUT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/
// Mirrors productFulfillmentPlanPattern in controller/product.go.
export const PRODUCT_FULFILLMENT_PLAN_PATTERN = /^[A-Za-z0-9_.-]{0,64}$/

export function getProductFormSchema(t: TFunction) {
  const inputFieldSchema = z.object({
    key: z
      .string()
      .trim()
      .regex(
        PRODUCT_INPUT_KEY_PATTERN,
        t(
          'Use lowercase letters, digits and underscores, starting with a letter'
        )
      ),
    label: z
      .string()
      .trim()
      .min(1, t('Label is required'))
      .max(64, t('Label cannot exceed 64 characters')),
    type: z.enum([
      'text',
      'textarea',
      'secret',
      'json',
      'base64',
      'chatgpt_session',
    ]),
    required: z.boolean(),
    placeholder: z.string(),
    description: z.string(),
    max_length: z.number().int().min(0).max(1048576),
  })

  const skuSchema = z
    .object({
      id: z.number().optional(),
      name: z
        .string()
        .trim()
        .min(1, t('Specification name is required'))
        .max(128, t('Specification name cannot exceed 128 characters')),
      price_amount: z
        .number()
        .min(0, t('Price cannot be negative'))
        .max(1000000, t('Price cannot exceed 1000000')),
      original_price: z
        .number()
        .min(0, t('Price cannot be negative'))
        .max(1000000, t('Price cannot exceed 1000000')),
      tag: z.string().trim().max(32, t('Tag cannot exceed 32 characters')),
      fulfillment_plan: z
        .string()
        .trim()
        .regex(
          PRODUCT_FULFILLMENT_PLAN_PATTERN,
          t(
            'Use letters, digits, dots, dashes and underscores (max 64 characters)'
          )
        ),
      currency: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{3,8}$/, t('Use a 3-8 letter currency code')),
      enabled: z.boolean(),
      sort_order: z.number().int(),
    })
    .refine(
      (sku) =>
        sku.original_price === 0 || sku.original_price >= sku.price_amount,
      {
        path: ['original_price'],
        message: t('Original price cannot be lower than the price'),
      }
    )

  return z.object({
    title: z
      .string()
      .trim()
      .min(1, t('Title is required'))
      .max(128, t('Title cannot exceed 128 characters')),
    subtitle: z
      .string()
      .trim()
      .max(255, t('Subtitle cannot exceed 255 characters')),
    icon: z.string().trim().max(1024),
    description: z.string(),
    enabled: z.boolean(),
    sort_order: z.number().int(),
    input_fields: z
      .array(inputFieldSchema)
      .max(20, t('At most 20 order fields per product'))
      .superRefine((fields, ctx) => {
        const seen = new Set<string>()
        fields.forEach((field, index) => {
          if (seen.has(field.key)) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'key'],
              message: t('Duplicate field key'),
            })
          }
          seen.add(field.key)
        })
      }),
    skus: z
      .array(skuSchema)
      .min(1, t('Add at least one specification'))
      .max(50, t('At most 50 specifications per product')),
  })
}

export type ProductFormValues = z.infer<ReturnType<typeof getProductFormSchema>>
export type ProductSkuFormValues = ProductFormValues['skus'][number]

export function createEmptyInputField(index: number): ProductInputField {
  return {
    key: `field_${index + 1}`,
    label: '',
    type: 'text',
    required: true,
    placeholder: '',
    description: '',
    max_length: 0,
  }
}

export function createEmptySku(): ProductSkuFormValues {
  return {
    name: '',
    price_amount: 0,
    original_price: 0,
    currency: 'USD',
    tag: '',
    fulfillment_plan: '',
    enabled: true,
    sort_order: 0,
  }
}

export const PRODUCT_FORM_DEFAULT_VALUES: ProductFormValues = {
  title: '',
  subtitle: '',
  icon: '',
  description: '',
  enabled: true,
  sort_order: 0,
  input_fields: [],
  skus: [createEmptySku()],
}

function skuToFormValues(sku: ProductSku): ProductSkuFormValues {
  return {
    id: sku.id,
    name: sku.name,
    price_amount: sku.price_amount,
    original_price: sku.original_price ?? 0,
    currency: sku.currency,
    tag: sku.tag ?? '',
    fulfillment_plan: sku.fulfillment_plan ?? '',
    enabled: sku.enabled,
    sort_order: sku.sort_order,
  }
}

export function productToFormValues(product: Product): ProductFormValues {
  return {
    title: product.title,
    subtitle: product.subtitle,
    icon: product.icon,
    description: product.description,
    enabled: product.enabled,
    sort_order: product.sort_order,
    input_fields: product.input_fields ?? [],
    skus: product.skus.map(skuToFormValues),
  }
}

export function formValuesToPayload(values: ProductFormValues): ProductPayload {
  return {
    ...values,
    skus: values.skus.map((sku) => ({ ...sku })),
  }
}
