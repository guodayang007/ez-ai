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
import type {
  ProductFulfillerHealth,
  ProductFulfillmentAttempt,
  ProductFulfillmentStepState,
  ProductOrder,
} from '../types'

/** Settings section that holds the fulfiller connection. */
export const FULFILLER_SETTINGS_SECTION = 'product-fulfillment'

/**
 * Whether "Execute payment" may buy a plan for the order with the DogPay card.
 * Mirrors CanStartProductFulfillment in model/product.go: any order status is
 * accepted; only a purchase that is still running blocks a new one.
 */
export function canExecutePayment(order: ProductOrder): boolean {
  return order.fulfillment_status !== 'running'
}

/**
 * Whether the fulfiller can take a payment: it answers and offers at least
 * one plan.
 */
export function isFulfillerReady(health: ProductFulfillerHealth): boolean {
  return health.status === 'ok' && health.plans.length > 0
}

/** A Claude order carries a Claude cookie; every other order is ChatGPT. */
export function isClaudeOrder(order: ProductOrder): boolean {
  return order.input_fields.some((field) => field.type === 'claude_cookie')
}

/** The plans the admin may buy for this order. */
export function getOrderPlans(
  order: ProductOrder,
  health: ProductFulfillerHealth
): string[] {
  return isClaudeOrder(order) ? (health.claude_plans ?? []) : health.plans
}

/**
 * The plan to preselect: the plan of the previous attempt, the only plan
 * offered, or for Claude the plan named by the SKU (such as "Max 5x").
 */
export function getDefaultPlan(order: ProductOrder, offered: string[]): string {
  if (order.fulfillment_plan && offered.includes(order.fulfillment_plan)) {
    return order.fulfillment_plan
  }
  if (offered.length === 1) return offered[0]
  if (!isClaudeOrder(order)) return ''
  const sku = order.sku_name.toLowerCase()
  let plan = ''
  if (sku.includes('20x')) plan = 'claude_max_20x'
  else if (sku.includes('5x')) plan = 'claude_max_5x'
  else if (sku.includes('pro')) plan = 'claude_pro'
  return offered.includes(plan) ? plan : ''
}

export type AttemptProgress = {
  /** The furthest step the attempt reached; null before any step ran. */
  current: ProductFulfillmentStepState | null
  /** The step that runs after the current one; null once the attempt ended. */
  next: ProductFulfillmentStepState | null
}

/** Where a payment attempt stands and, while it runs, what comes next. */
export function getAttemptProgress(
  attempt: ProductFulfillmentAttempt
): AttemptProgress {
  const index = attempt.steps.findIndex(
    (step) => step.key === attempt.current_step
  )
  const current = index >= 0 ? attempt.steps[index] : null
  if (attempt.status !== 'running') return { current, next: null }
  return { current, next: attempt.steps[index + 1] ?? null }
}
