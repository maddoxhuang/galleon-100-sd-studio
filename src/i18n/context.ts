import { createContext, useContext } from 'react';
import { MESSAGES, type Messages } from './messages';

/** Interface text for the current language; Studio provides it to every panel. */
export const MessagesContext = createContext<Messages>(MESSAGES.en);
export const useMessages = () => useContext(MessagesContext);
