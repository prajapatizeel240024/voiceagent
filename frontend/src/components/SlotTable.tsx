import type { PartialCallSlots } from "../types";

interface Props {
  slots: PartialCallSlots;
}

const SLOT_ORDER: Array<{
  key: keyof PartialCallSlots;
  label: string;
}> = [
  { key: "application_status", label: "Application status" },
  { key: "missing_items", label: "Missing items" },
  { key: "expected_decision_date", label: "Expected decision" },
  { key: "reference_number", label: "Reference number" },
  { key: "rep_name", label: "Rep name" },
  { key: "notes", label: "Notes" },
];

const STATUS_COLOR: Record<string, string> = {
  in_review: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  missing_info: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  denied: "bg-red-500/15 text-red-400 border-red-500/30",
  pending_committee: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  not_found: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  unknown: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

export function SlotTable({ slots }: Props) {
  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-panel2">
        <h3 className="text-sm font-semibold text-text">Structured capture</h3>
        <p className="text-xs text-muted mt-0.5">
          Pydantic-equivalent slots, populated live from the call
        </p>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {SLOT_ORDER.map(({ key, label }) => {
            const value = slots[key];
            const isFilled = value !== null && value !== undefined &&
              !(Array.isArray(value) && value.length === 0) && value !== "";
            return (
              <tr
                key={key}
                className="border-b border-border last:border-0"
              >
                <td className="px-4 py-3 text-muted font-medium w-1/3">
                  {label}
                </td>
                <td className="px-4 py-3">
                  {!isFilled ? (
                    <span className="text-muted italic text-xs">
                      — waiting —
                    </span>
                  ) : key === "application_status" ? (
                    <span
                      className={`badge border ${STATUS_COLOR[value as string] || STATUS_COLOR.unknown}`}
                    >
                      {String(value).replace(/_/g, " ")}
                    </span>
                  ) : Array.isArray(value) ? (
                    <ul className="space-y-1">
                      {value.map((v, i) => (
                        <li
                          key={i}
                          className="text-text text-xs bg-panel2 rounded px-2 py-1 inline-block mr-1"
                        >
                          {v}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-text font-mono text-xs">
                      {String(value)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
