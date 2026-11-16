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
import type { ControllerRenderProps } from 'react-hook-form'

import { PasswordInput } from '@/components/password-input'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ProductInputField } from '@/features/products/types'

import type { OrderFormValues } from '../lib/order-form'

type OrderInputControlProps = {
  field: ProductInputField
  controller: ControllerRenderProps<OrderFormValues, `inputs.${string}`>
}

/** Renders the input control that matches an order field's type. */
export function OrderInputControl(props: OrderInputControlProps) {
  const placeholder = props.field.placeholder || undefined
  if (props.field.type === 'secret') {
    return (
      <PasswordInput
        {...props.controller}
        placeholder={placeholder}
        autoComplete='off'
      />
    )
  }
  if (props.field.type === 'text') {
    return <Input {...props.controller} placeholder={placeholder} />
  }
  const monospace = props.field.type !== 'textarea'
  return (
    <Textarea
      {...props.controller}
      placeholder={placeholder}
      rows={monospace ? 6 : 4}
      spellCheck={!monospace}
      className={monospace ? 'font-mono text-xs' : undefined}
    />
  )
}
