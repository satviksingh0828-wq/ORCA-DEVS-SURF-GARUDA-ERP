export type RemoteInputMessage =
  | {
      type: "move" | "pointerdown" | "pointerup" | "click" | "contextmenu";
      x: number;
      y: number;
      button?: number;
      buttons?: number;
    }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | {
      type: "key";
      key: string;
      code: string;
      down: boolean;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      meta: boolean;
    }
  | { type: "text"; text: string }
  | { type: "edit"; key: "Backspace" | "Delete" };
