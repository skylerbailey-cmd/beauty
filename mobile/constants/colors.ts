export const Colors = {
  primary: '#D4A0A0',     // dusty rose
  secondary: '#C9956C',   // warm gold
  background: '#FDF6F0',  // cream
  surface: '#FFFFFF',
  text: '#2D2D2D',
  textLight: '#8A8A8A',
  success: '#6B9E6B',
  danger: '#C96C6C',
  accent: '#E8C4B8',      // light pink
  border: '#EDE0D8',
  shadowColor: '#C0A090',
} as const;

export type ColorKey = keyof typeof Colors;
