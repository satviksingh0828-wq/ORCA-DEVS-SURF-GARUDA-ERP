import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

interface OrcaAIContextValue {
  open: boolean;
  expanded: boolean;
  setOpen: (v: boolean) => void;
  setExpanded: (v: boolean) => void;
  toggle: () => void;
}

const OrcaAIContext = createContext<OrcaAIContextValue>({
  open: false,
  expanded: false,
  setOpen: () => {},
  setExpanded: () => {},
  toggle: () => {},
});

export function OrcaAIProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (!value) setExpanded(false);
  };
  const toggle = () => changeOpen(!open);
  return (
    <OrcaAIContext.Provider value={{ open, expanded, setOpen: changeOpen, setExpanded, toggle }}>
      {children}
    </OrcaAIContext.Provider>
  );
}

// The provider and hook intentionally share this small context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useOrcaAI() {
  return useContext(OrcaAIContext);
}
