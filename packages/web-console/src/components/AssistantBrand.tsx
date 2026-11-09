import {createContext, useContext} from 'react';
export interface AssistantBrand {name: string; icon: 'moon' | 'star' | 'robot' | 'leaf'}
export const defaultBrand: AssistantBrand = {name:'Night Bot',icon:'moon'};
export const AssistantBrandContext = createContext<AssistantBrand>(defaultBrand);
export const useAssistantBrand = () => useContext(AssistantBrandContext);
export const brandGlyph = (icon: AssistantBrand['icon']) => ({moon:'☾',star:'✦',robot:'🤖',leaf:'❧'}[icon] || '☾');
