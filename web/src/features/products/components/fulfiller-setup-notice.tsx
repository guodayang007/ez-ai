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
import { Link } from '@tanstack/react-router'
import { AlertTriangle, RefreshCw, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import {
  FULFILLER_SETTINGS_SECTION,
  isFulfillerReady,
} from '../lib/fulfillment'
import type { ProductFulfillerField, ProductFulfillerHealth } from '../types'

const START_COMMAND = 'cd services/dogpay-fulfiller && node src/server.mjs'
const CREATE_KEY_COMMAND =
  'echo "CONFIG_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env'

type FulfillerSetupNoticeProps = {
  health: ProductFulfillerHealth
  /** Hidden on the settings page itself, or when another button leads there. */
  showSettingsLink: boolean
  /** Omitted when another button already re-checks the service. */
  onRecheck?: () => void
  isRechecking: boolean
}

/** Explains why DogPay auto-fulfillment cannot run and what to fix. */
export function FulfillerSetupNotice(props: FulfillerSetupNoticeProps) {
  const { t } = useTranslation()
  const health = props.health
  if (isFulfillerReady(health)) return null

  const url = health.service_url
  let title = ''
  const steps: Array<{ text: string; command?: string }> = []
  switch (health.status) {
    case 'key_missing':
      title = t('The settings encryption key is not set')
      steps.push({
        text: t(
          'Add CONFIG_ENCRYPTION_KEY (at least 32 random characters) to the .env of the ez-ai server. Keep it safe: settings saved under it cannot be read with another key'
        ),
        command: CREATE_KEY_COMMAND,
      })
      steps.push({
        text: t('Restart ez-ai, then fill in the fulfillment settings'),
      })
      break
    case 'config_unreadable':
      title = t('The saved fulfillment settings cannot be decrypted')
      steps.push({
        text: t(
          'CONFIG_ENCRYPTION_KEY changed after they were saved. Restore the previous key and restart ez-ai, or enter the settings again'
        ),
      })
      break
    case 'not_configured': {
      title = t('DogPay auto-fulfillment is not set up')
      const labels: Record<ProductFulfillerField, string> = {
        url: t('Fulfillment service URL'),
        secret: t('Shared secret'),
        plans: t('Plans to buy'),
        card_number: t('Card number'),
        card_expiry: t('Expiry (MM/YY)'),
        card_cvc: t('CVC'),
        card_holder: t('Cardholder name'),
      }
      steps.push({
        text: t('Fill in: {{fields}}', {
          fields: health.missing.map((field) => labels[field]).join(', '),
        }),
      })
      break
    }
    case 'unreachable':
      title = t('The fulfillment service is not running')
      steps.push({ text: t('Nothing answered at {{url}}', { url }) })
      steps.push({
        text: t('Start the service on the ez-ai server:'),
        command: START_COMMAND,
      })
      steps.push({
        text: t(
          'If it exits with "Invalid configuration", set FULFILLER_SECRET in services/dogpay-fulfiller/.env to the shared secret and start it again'
        ),
      })
      steps.push({
        text: t(
          'If the service runs at another address, correct the service URL in settings'
        ),
      })
      break
    case 'unauthorized':
      title = t('The shared secret does not match the fulfillment service')
      steps.push({
        text: t(
          'The service at {{url}} rejected the signature. Make the shared secret in settings equal to FULFILLER_SECRET in services/dogpay-fulfiller/.env',
          { url }
        ),
      })
      steps.push({
        text: t('Also check that the clocks of both servers are correct'),
      })
      break
    case 'error':
      title = t('The fulfillment service returned an error')
      steps.push({
        text: t(
          'Check the ez-ai server log and the fulfillment service output for the cause'
        ),
      })
      break
  }

  return (
    <Alert variant='destructive'>
      <AlertTriangle aria-hidden='true' />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className='space-y-2'>
        <ol className='list-decimal space-y-1 ps-4'>
          {steps.map((step) => (
            <li key={step.text}>
              {step.text}
              {step.command && (
                <div className='bg-muted text-foreground mt-1 flex items-center gap-2 rounded-md px-2 py-1'>
                  <code className='min-w-0 flex-1 truncate font-mono text-xs'>
                    {step.command}
                  </code>
                  <CopyButton
                    value={step.command}
                    size='icon'
                    aria-label={t('Copy command')}
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
        <div className='flex flex-wrap gap-2 pt-1 empty:hidden'>
          {props.showSettingsLink && (
            <Button
              size='sm'
              variant='outline'
              render={
                <Link
                  to='/system-settings/billing/$section'
                  params={{ section: FULFILLER_SETTINGS_SECTION }}
                />
              }
            >
              <Settings aria-hidden='true' />
              {t('Open fulfillment settings')}
            </Button>
          )}
          {props.onRecheck && (
            <Button
              size='sm'
              variant='outline'
              onClick={props.onRecheck}
              disabled={props.isRechecking}
            >
              <RefreshCw aria-hidden='true' />
              {t('Check again')}
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
