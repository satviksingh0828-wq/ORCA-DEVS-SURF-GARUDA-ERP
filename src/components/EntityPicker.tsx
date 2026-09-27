import { useState } from "react";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type PickerOption = { id: string; label: string; sub?: string };

export function EntityPicker({
  label,
  placeholder = "Select",
  value,
  options,
  onChange,
  onAdd,
  addLabel,
  full,
  disabled = false,
}: {
  label: string;
  placeholder?: string;
  value: string | null | undefined;
  options: PickerOption[];
  onChange: (id: string | null) => void;
  onAdd?: () => void;
  addLabel?: string;
  full?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);

  return (
    <div className={cn("space-y-1.5", full && "sm:col-span-2")}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-10 w-full justify-between font-normal"
            disabled={disabled}
          >
            <span className="flex min-w-0 items-center gap-2 truncate">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              {selected ? (
                <span className="truncate">{selected.label}</span>
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search…" />
            <CommandList>
              <CommandEmpty>Nothing found.</CommandEmpty>
              <CommandGroup>
                {onAdd ? (
                  <CommandItem
                    value="__add_new__"
                    onSelect={() => {
                      setOpen(false);
                      onAdd();
                    }}
                  >
                    <Plus className="size-4" />
                    <span>{addLabel ?? "Add new"}</span>
                  </CommandItem>
                ) : null}
                {options.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={`${o.label} ${o.sub ?? ""}`}
                    onSelect={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("size-4", value === o.id ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{o.label}</span>
                    {o.sub ? (
                      <span className="ml-auto text-xs text-muted-foreground">{o.sub}</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
