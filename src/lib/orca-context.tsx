import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

interface OrcaAIContextValue {
  open: boolean;
  expanded: boolean;
  setOpen: (v: boolean) => void;
  setExpanded: (v: boolean) => void;
  toggle: () => void;
  agentOpen: boolean;
  setAgentOpen: (v: boolean) => void;
  toggleAgent: () => void;
}

const OrcaAIContext = createContext<OrcaAIContextValue>({
  open: false,
  expanded: false,
  setOpen: () => {},
  setExpanded: () => {},
  toggle: () => {},
  agentOpen: false,
  setAgentOpen: () => {},
  toggleAgent: () => {},
});

export function OrcaAIProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (!value) setExpanded(false);
  };
  const toggle = () => changeOpen(!open);
  const toggleAgent = () => setAgentOpen((value) => !value);
  return (
    <OrcaAIContext.Provider
      value={{
        open,
        expanded,
        setOpen: changeOpen,
        setExpanded,
        toggle: toggle,
        agentOpen,
        setAgentOpen,
        toggleAgent,
      }}
    >
      {children}
    </OrcaAIContext.Provider>
  );
}

// The provider and hook intentionally share this small context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useOrcaAI() {
  return useContext(OrcaAIContext);
}
