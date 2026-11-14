import React from 'react';
import { createRoot } from 'react-dom/client';
import CardPreview from './CardPreview';
import { applyAppearance } from '../../src/lib/appearance';
const search = new URLSearchParams(location.search);
applyAppearance(document.documentElement, { version: 1, paletteId: 'default', appearance: search.get('theme') === 'dark' ? 'dark' : 'light' }, false);
createRoot(document.getElementById('root')!).render(<CardPreview />);
