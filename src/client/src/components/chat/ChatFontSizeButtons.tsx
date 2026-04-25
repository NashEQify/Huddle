/**
 * ChatFontSizeButtons — A-up / A-down icons to increase/decrease chat font size.
 * Uses Lucide AArrowUp / AArrowDown per Spec 05.4.
 */

import { useState } from 'react';
import { AArrowUp, AArrowDown } from 'lucide-react';
import {
  getChatFontSize,
  increaseChatFontSize,
  decreaseChatFontSize,
} from '../../stores/chatFontSize';
import { IconButton } from '../ui/IconButton';

export function ChatFontSizeButtons() {
  const [size, setSize] = useState(getChatFontSize);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        flexShrink: 0,
      }}
    >
      <IconButton
        icon={AArrowUp}
        label="Increase font size"
        color="var(--text-primary)"
        size={28}
        onClick={() => setSize(increaseChatFontSize())}
        style={{ minWidth: '36px', minHeight: '36px', padding: '2px' }}
      />
      <IconButton
        icon={AArrowDown}
        label="Decrease font size"
        color="var(--text-primary)"
        size={28}
        onClick={() => setSize(decreaseChatFontSize())}
        style={{ minWidth: '36px', minHeight: '36px', padding: '2px' }}
      />
    </div>
  );
}
