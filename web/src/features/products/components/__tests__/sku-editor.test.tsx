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
import { render, screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { describe, expect, test } from 'vitest'

import { Form } from '@/components/ui/form'

import {
  PRODUCT_FORM_DEFAULT_VALUES,
  createEmptySku,
  type ProductFormValues,
} from '../../lib/product-form'
import { SkuEditor } from '../sku-editor'

function Harness(props: { sku: ProductFormValues['skus'][number] }) {
  const form = useForm<ProductFormValues>({
    defaultValues: { ...PRODUCT_FORM_DEFAULT_VALUES, skus: [props.sku] },
  })
  return (
    <Form {...form}>
      <SkuEditor
        control={form.control}
        index={0}
        canRemove={false}
        onRemove={() => {}}
      />
    </Form>
  )
}

describe('sku editor', () => {
  test('header shows the specification name once it is entered', () => {
    render(<Harness sku={{ ...createEmptySku(), name: 'Plus / 1 month' }} />)

    expect(
      screen.getByText('Plus / 1 month', { selector: 'p' })
    ).toBeInTheDocument()
  })

  test('header falls back to the numbered title when the name is empty', () => {
    render(<Harness sku={{ ...createEmptySku(), name: '' }} />)

    expect(screen.getByText('Specification 1')).toBeInTheDocument()
  })

  test('specification card does not offer per-specification order fields', () => {
    render(<Harness sku={createEmptySku()} />)

    expect(
      screen.queryByRole('button', { name: 'Add field' })
    ).not.toBeInTheDocument()
  })
})
