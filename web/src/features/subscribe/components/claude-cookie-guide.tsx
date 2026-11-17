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

import { Button } from '@/components/ui/button'
import { CLAUDE_HOME_URL } from '@/features/store/lib/claude-cookie'

import { GuideStep } from './session-guide'

/** Step-by-step instructions for copying the claude.ai Cookie. */
export function ClaudeCookieGuide() {
  const { t } = useTranslation()

  return (
    <ol>
      <GuideStep
        index={1}
        title={t('Sign in to Claude')}
        description={t(
          'Open Claude in a new tab and sign in to the account you want to upgrade.'
        )}
      >
        <Button
          variant='outline'
          size='sm'
          render={
            <a
              href={CLAUDE_HOME_URL}
              target='_blank'
              rel='noopener noreferrer'
            />
          }
        >
          {t('Open Claude')}
          <ExternalLink aria-hidden='true' />
        </Button>
      </GuideStep>
      <GuideStep
        index={2}
        title={t('Open the browser cookies')}
        description={t(
          'On the Claude tab press F12 (⌥⌘I on Mac) to open the developer tools, then go to Application (Storage in Firefox) → Cookies → https://claude.ai.'
        )}
      />
      <GuideStep
        index={3}
        title={t('Copy the sessionKey')}
        description={t(
          'Find the cookie named sessionKey and copy its value, which starts with sk-ant-sid. The whole Cookie header of any claude.ai request in the Network tab also works.'
        )}
      />
      <GuideStep
        index={4}
        title={t('Paste it below')}
        description={t('Paste it into the box below, then tap Confirm.')}
      />
    </ol>
  )
}
