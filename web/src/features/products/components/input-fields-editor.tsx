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
import { ClipboardList, Plus, Trash2 } from 'lucide-react'
import { type Control, useFieldArray } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  SideDrawerSection,
  SideDrawerSectionHeader,
} from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import { PRODUCT_INPUT_TYPES } from '../constants'
import {
  createEmptyInputField,
  type ProductFormValues,
} from '../lib/product-form'

type InputFieldsEditorProps = {
  control: Control<ProductFormValues>
}

export function InputFieldsEditor(props: InputFieldsEditorProps) {
  const { t } = useTranslation()
  const name = 'input_fields' as const
  const fieldArray = useFieldArray({ control: props.control, name })
  const typeItems = PRODUCT_INPUT_TYPES.map((item) => ({
    value: item.value,
    label: t(item.labelKey),
  }))

  return (
    <SideDrawerSection>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <SideDrawerSectionHeader
          className='min-w-0 flex-1'
          title={t('Order fields')}
          description={t(
            'Shared by every specification. Information the buyer must provide when ordering, such as a session key or account data'
          )}
          icon={<ClipboardList />}
          iconTone='warning'
        />
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() =>
            fieldArray.append(createEmptyInputField(fieldArray.fields.length))
          }
        >
          <Plus />
          {t('Add field')}
        </Button>
      </div>

      {fieldArray.fields.length === 0 && (
        <p className='text-muted-foreground rounded-lg border border-dashed px-4 py-5 text-center text-xs'>
          {t(
            'No order fields. Buyers can order without providing extra information.'
          )}
        </p>
      )}

      {fieldArray.fields.map((item, fieldIndex) => (
        <div key={item.id} className='bg-muted/30 rounded-lg border'>
          <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('Field {{index}}', { index: fieldIndex + 1 })}
            </span>
            <div className='flex items-center gap-1'>
              <FormField
                control={props.control}
                name={`${name}.${fieldIndex}.required`}
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center gap-2'>
                    <FormLabel className='!mt-0 text-xs'>
                      {t('Required')}
                    </FormLabel>
                    <FormControl>
                      <Switch
                        size='sm'
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                className='text-muted-foreground hover:text-destructive ms-1'
                onClick={() => fieldArray.remove(fieldIndex)}
                aria-label={t('Remove field')}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          <div className='grid items-start gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3'>
            <FormField
              control={props.control}
              name={`${name}.${fieldIndex}.label`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t('Label')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('e.g. Contact email')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={props.control}
              name={`${name}.${fieldIndex}.key`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t('Field key')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className='font-mono'
                      placeholder='contact_email'
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={props.control}
              name={`${name}.${fieldIndex}.type`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Field type')}</FormLabel>
                  <Select
                    items={typeItems}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger className='w-full'>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        {typeItems.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={props.control}
              name={`${name}.${fieldIndex}.placeholder`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Placeholder')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={props.control}
              name={`${name}.${fieldIndex}.description`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Help text')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={props.control}
              name={`${name}.${fieldIndex}.max_length`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max length')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      value={field.value}
                      onChange={(e) =>
                        field.onChange(Number.parseInt(e.target.value, 10) || 0)
                      }
                      placeholder={t('0 = default (64 KB)')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      ))}
    </SideDrawerSection>
  )
}
