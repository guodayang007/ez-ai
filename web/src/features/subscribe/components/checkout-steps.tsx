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
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

type CheckoutStepsProps = {
  /** Already translated step labels, in order. */
  labels: string[]
  /** Zero-based index of the current step. */
  current: number
}

/** A compact progress indicator for the subscription checkout. */
export function CheckoutSteps(props: CheckoutStepsProps) {
  return (
    <ol className='flex items-center gap-2 sm:gap-3'>
      {props.labels.map((label, index) => {
        const done = index < props.current
        const active = index === props.current
        return (
          <li
            key={label}
            className='flex min-w-0 flex-1 items-center gap-2 sm:gap-3'
            aria-current={active ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                done && 'border-primary bg-primary text-primary-foreground',
                active && 'border-primary text-primary ring-primary/20 ring-4',
                !done && !active && 'text-muted-foreground'
              )}
            >
              {done ? <Check className='size-4' aria-hidden='true' /> : index + 1}
            </span>
            <span
              className={cn(
                'truncate text-sm',
                active ? 'font-semibold' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
            {index < props.labels.length - 1 && (
              <span
                aria-hidden='true'
                className={cn(
                  'h-px min-w-4 flex-1',
                  done ? 'bg-primary' : 'bg-border'
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
