import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Plus, Search, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { lookupIndiaPin } from "@/lib/india-post";

export type LocationOption = {
  id: string;
  location_name: string;
  location_type: string | null;
  city: string | null;
  state: string | null;
  pin_code: string | null;
};

const EMPTY_LOC = {
  location_name: "",
  location_type: "",
  city: "",
  district: "",
  state: "",
  country: "",
  pin_code: "",
};

export function LocationPicker({
  label,
  value,
  onChange,
  onPinCode,
  disabled = false,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (id: string | null, loc?: LocationOption) => void;
  onPinCode?: (pin: string) => void;
  disabled?: boolean;
}) {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [open, setOpen] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_LOC });
  const [saving, setSaving] = useState(false);
  const [pinLooking, setPinLooking] = useState(false);
  const [pinLooked, setPinLooked] = useState(false); // whether we already looked up the current pin

  async function load() {
    const { data } = await supabase
      .from("locations")
      .select("id,location_name,location_type,city,state,pin_code")
      .order("location_name", { ascending: true });
    setLocations((data as LocationOption[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  const selected = locations.find((l) => l.id === value);

  // Auto-lookup when PIN changes to 6 digits in the dialog
  async function handleDialogPinChange(pin: string) {
    setForm((f) => ({ ...f, pin_code: pin }));
    setPinLooked(false);
    if (pin.length === 6 && /^\d{6}$/.test(pin)) {
      setPinLooking(true);
      const result = await lookupIndiaPin(pin);
      setPinLooking(false);
      setPinLooked(true);
      if (result) {
        setForm((f) => ({
          ...f,
          pin_code: pin,
          city: f.city || result.district,
          district: result.district,
          state: f.state || result.state,
          country: f.country || result.country,
          // suggest location name from first post office if blank
          location_name: f.location_name || result.district,
          location_type: f.location_type || "Domestic",
        }));
        toast.success(`PIN ${pin} — ${result.district}, ${result.state}`);
      } else {
        toast.error(`PIN ${pin} not found in Indian Post database.`);
      }
    }
  }

  async function saveNew(e: React.FormEvent) {
    e.preventDefault();
    if (!form.location_name.trim()) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("locations")
      .insert(form as never)
      .select("id,location_name,location_type,city,state,pin_code")
      .single();
    setSaving(false);
    if (error || !data) return toast.error(error?.message ?? "Failed to save");
    toast.success("Location created");
    const loc = data as LocationOption;
    setLocations((prev) => [...prev, loc].sort((a, b) =>
      a.location_name.localeCompare(b.location_name),
    ));
    onChange(loc.id, loc);
    if (onPinCode && loc.pin_code) onPinCode(loc.pin_code);
    setShowDialog(false);
    setForm({ ...EMPTY_LOC });
    setPinLooked(false);
  }

  function openDialog() {
    setForm({ ...EMPTY_LOC });
    setPinLooked(false);
    setOpen(false);
    setShowDialog(true);
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              className="h-10 w-full justify-between font-normal"
              disabled={disabled}
            >
              <span className="flex min-w-0 items-center gap-2 truncate">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                {selected ? (
                  <span className="truncate">{selected.location_name}</span>
                ) : (
                  <span className="text-muted-foreground">Select location</span>
                )}
              </span>
              <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search locations…" />
              <CommandList>
                <CommandEmpty>No locations found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="__add_new__"
                    onSelect={openDialog}
                  >
                    <Plus className="size-4" />
                    <span>Add new location</span>
                  </CommandItem>
                  {locations.map((l) => (
                    <CommandItem
                      key={l.id}
                      value={`${l.location_name} ${l.city ?? ""} ${l.pin_code ?? ""}`}
                      onSelect={() => {
                        onChange(l.id, l);
                        if (onPinCode) onPinCode(l.pin_code ?? "");
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn("size-4", value === l.id ? "opacity-100" : "opacity-0")}
                      />
                      <span className="truncate">{l.location_name}</span>
                      {l.city ? (
                        <span className="ml-auto text-xs text-muted-foreground">{l.city}</span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <Dialog open={showDialog} onOpenChange={(o) => { setShowDialog(o); if (!o) { setForm({ ...EMPTY_LOC }); setPinLooked(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add new location</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveNew} className="space-y-4">

            {/* PIN code first — triggers auto-fill */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <MapPin className="size-3.5 text-primary" />
                Enter PIN code to auto-fill location details
              </p>
              <div className="flex gap-2">
                <Input
                  className="h-10 font-mono"
                  maxLength={6}
                  placeholder="6-digit PIN code"
                  value={form.pin_code}
                  onChange={(e) => handleDialogPinChange(e.target.value.replace(/\D/g, ""))}
                />
                {pinLooking && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Looking up…
                  </div>
                )}
                {pinLooked && !pinLooking && form.state && (
                  <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                    <Check className="size-3.5" /> Filled
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldInput
                label="Location Name"
                required
                full
                value={form.location_name}
                onChange={(v) => setForm({ ...form, location_name: v })}
              />
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Type</Label>
                <Select
                  value={form.location_type || undefined}
                  onValueChange={(v) => setForm({ ...form, location_type: v })}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Domestic">Domestic</SelectItem>
                    <SelectItem value="International">International</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <FieldInput
                label="City"
                value={form.city}
                onChange={(v) => setForm({ ...form, city: v })}
              />
              <FieldInput
                label="District"
                value={form.district}
                onChange={(v) => setForm({ ...form, district: v })}
              />
              <FieldInput
                label="State"
                value={form.state}
                onChange={(v) => setForm({ ...form, state: v })}
              />
              <FieldInput
                label="Country"
                value={form.country}
                onChange={(v) => setForm({ ...form, country: v })}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save location
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  required,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  full?: boolean;
}) {
  return (
    <div className={`space-y-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="h-10"
      />
    </div>
  );
}
