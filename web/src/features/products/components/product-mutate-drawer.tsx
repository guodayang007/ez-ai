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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, Package, Plus } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { type Resolver, useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  SideDrawerSection,
  SideDrawerSectionHeader,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
  sideDrawerSwitchItemClassName,
} from '@/components/drawer-layout'
import { LobeIconField } from '@/components/lobe-icon-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { createProduct, updateProduct } from '../api'
import { PRODUCT_QUERY_KEYS } from '../constants'
import {
  PRODUCT_FORM_DEFAULT_VALUES,
  createEmptySku,
  formValuesToPayload,
  getProductFormSchema,
  productToFormValues,
  type ProductFormValues,
} from '../lib/product-form'
import type { Product } from '../types'
import { InputFieldsEditor } from './input-fields-editor'
import { SkuEditor } from './sku-editor'

type ProductMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: Product | null
}

export function ProductMutateDrawer(props: ProductMutateDrawerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isUpdate = props.product !== null
  const schema = useMemo(() => getProductFormSchema(t), [t])
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<ProductFormValues>,
    defaultValues: PRODUCT_FORM_DEFAULT_VALUES,
  })
  const skus = useFieldArray({ control: form.control, name: 'skus' })

  useEffect(() => {
    if (!props.open) return
    form.reset(
      props.product
        ? productToFormValues(props.product)
        : PRODUCT_FORM_DEFAULT_VALUES
    )
  }, [props.open, props.product, form])

  const mutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const payload = formValuesToPayload(values)
      const result = props.product
        ? await updateProduct(props.product.id, payload)
        : await createProduct(payload)
      if (!result.success) throw createServerError(result)
      return result
    },
    onSuccess: () => {
      toast.success(isUpdate ? t('Product updated') : t('Product created'))
      void queryClient.invalidateQueries({
        queryKey: PRODUCT_QUERY_KEYS.adminProducts,
      })
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
  })

  const skusError = form.formState.errors.skus?.root?.message
  const skusArrayError = form.formState.errors.skus?.message

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-5xl')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isUpdate ? t('Edit product') : t('Create product')}
          </SheetTitle>
          <SheetDescription>
            {t(
              'Each specification has its own price and can ask the buyer for extra information when ordering.'
            )}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='product-form'
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            className={sideDrawerFormClassName()}
          >
            <fieldset disabled={mutation.isPending} className='contents'>
              <SideDrawerSection>
                <SideDrawerSectionHeader
                  title={t('Basic information')}
                  description={t(
                    'Name, icon and how the product appears in the store'
                  )}
                  icon={<Package />}
                  iconTone='primary'
                />
                <div className='grid gap-4 md:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='title'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('Title')}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder='ChatGPT Plus' />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='subtitle'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Subtitle')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t('e.g. Official subscription top-up')}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='icon'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Icon')}</FormLabel>
                        <LobeIconField
                          value={field.value}
                          onChange={field.onChange}
                        />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='sort_order'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Sort order')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            value={field.value}
                            onChange={(e) =>
                              field.onChange(
                                Number.parseInt(e.target.value, 10) || 0
                              )
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {t('Higher values are shown first')}
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='description'
                    render={({ field }) => (
                      <FormItem className='md:col-span-2'>
                        <FormLabel>{t('Description')}</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={4} />
                        </FormControl>
                        <FormDescription>
                          {t('Shown to buyers on the product card')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='enabled'
                    render={({ field }) => (
                      <FormItem
                        className={sideDrawerSwitchItemClassName(
                          'md:col-span-2'
                        )}
                      >
                        <FormLabel className='!mt-0'>{t('On sale')}</FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </SideDrawerSection>

              <InputFieldsEditor control={form.control} />

              <SideDrawerSection>
                <div className='flex items-start justify-between gap-3'>
                  <SideDrawerSectionHeader
                    title={t('Specifications')}
                    description={t(
                      'Each specification is sold separately with its own price'
                    )}
                    icon={<Layers />}
                    iconTone='info'
                  />
                  <Badge variant='secondary' className='shrink-0'>
                    {skus.fields.length}
                  </Badge>
                </div>
                {skus.fields.map((item, index) => (
                  <SkuEditor
                    key={item.id}
                    control={form.control}
                    index={index}
                    canRemove={skus.fields.length > 1}
                    onRemove={() => skus.remove(index)}
                  />
                ))}
                {(skusError || skusArrayError) && (
                  <p className='text-destructive text-sm'>
                    {skusError || skusArrayError}
                  </p>
                )}
                <Button
                  type='button'
                  variant='outline'
                  className='h-11 w-full border-dashed'
                  onClick={() => skus.append(createEmptySku())}
                >
                  <Plus />
                  {t('Add specification')}
                </Button>
              </SideDrawerSection>
            </fieldset>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button
            form='product-form'
            type='submit'
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
