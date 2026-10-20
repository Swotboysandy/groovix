import React, { createContext, useContext } from 'react';

export const AppResetContext = createContext<() => void>(() => {});
export const useResetApp = () => useContext(AppResetContext);
