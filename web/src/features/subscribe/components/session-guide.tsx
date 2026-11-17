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
import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import {
  CHATGPT_HOME_URL,
  CHATGPT_SESSION_URL,
} from '@/features/store/lib/chatgpt-session'

export function GuideStep(props: {
  index: number
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <li className='group relative flex gap-4 pb-6 last:pb-0'>
      <span
        aria-hidden='true'
        className='bg-border absolute top-8 bottom-0 left-[13px] w-px group-last:hidden'
      />
      <span className='bg-primary/10 text-primary relative flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
        {props.index}
      </span>
      <div className='min-w-0 flex-1 space-y-2 pt-0.5'>
        <p className='text-sm font-medium'>{props.title}</p>
        <p className='text-muted-foreground text-sm leading-relaxed'>
          {props.description}
        </p>
        {props.children}
      </div>
    </li>
  )
}

/** Step-by-step instructions for copying the ChatGPT session JSON. */
export function SessionGuide() {
  const { t } = useTranslation()

  return (
    <ol>
      <GuideStep
        index={1}
        title={t('Sign in to ChatGPT')}
        description={t(
          'Open ChatGPT in a new tab and sign in to the account you want to upgrade.'
        )}
      >
        <Button
          variant='outline'
          size='sm'
          render={
            <a
              href={CHATGPT_HOME_URL}
              target='_blank'
              rel='noopener noreferrer'
            />
          }
        >
          {t('Open ChatGPT')}
          <ExternalLink aria-hidden='true' />
        </Button>
      </GuideStep>
      <GuideStep
        index={2}
        title={t('Open the session page')}
        description={t(
          'In the same browser, visit the address below. The page shows a block of JSON text.'
        )}
      >
        <div className='flex flex-wrap items-center gap-2'>
          <code className='bg-muted rounded-md px-2.5 py-1.5 font-mono text-xs break-all'>
            {CHATGPT_SESSION_URL}
          </code>
          <CopyButton
            value={CHATGPT_SESSION_URL}
            variant='outline'
            size='icon'
            tooltip={t('Copy link')}
          />
          <Button
            size='sm'
            render={
              <a
                href={CHATGPT_SESSION_URL}
                target='_blank'
                rel='noopener noreferrer'
              />
            }
          >
            {t('Open session page')}
            <ExternalLink aria-hidden='true' />
          </Button>
        </div>
      </GuideStep>
      <GuideStep
        index={3}
        title={t('Copy everything and paste it below')}
        description={t(
          'Select all (Ctrl/⌘ + A), copy the whole page, paste it into the box below, then tap Confirm.'
        )}
      />
    </ol>
  )
}
