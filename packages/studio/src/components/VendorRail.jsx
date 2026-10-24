"use client";

import { IconStar } from "@tabler/icons-react";
import { vendorById } from "../vendors.js";

// Vendor filter for the model pickers. Collapsed it is a column of monogram
// tiles; hovering the rail (or tabbing into it) widens it to show each
// vendor's full name and how many models it has in the current list.
export default function VendorRail({ vendors, selected, onSelect, allLabel, allCount }) {
  const item = (id, label, count, mono, color, isAll = false) => {
    const isSelected = selected === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onSelect(id)}
        aria-pressed={isSelected}
        title={label}
        className={`group/vendor flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[9px] px-1 text-left transition-colors ${
          isSelected ? "bg-primary/[0.08] text-white" : "text-white/55 hover:bg-white/[0.05] hover:text-white"
        }`}
      >
        <span
          className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border text-[11px] font-semibold ${
            isSelected ? "border-primary/40 bg-primary/10" : "border-white/[0.07] bg-white/[0.04]"
          } ${isAll ? (isSelected ? "text-yellow-400" : "text-white/55") : color}`}
        >
          {isAll ? <IconStar size={14} stroke={2} fill={isSelected ? "currentColor" : "none"} aria-hidden="true" /> : mono}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
          {label}
        </span>
        <span className="pr-1 text-[11px] tabular-nums text-white/35 opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
          {count}
        </span>
      </button>
    );
  };

  return (
    <div
      className="group/rail flex w-[46px] shrink-0 flex-col gap-1 overflow-y-auto overflow-x-hidden border-r border-white/[0.06] pr-2 scrollbar-none transition-[width] duration-200 ease-[cubic-bezier(.16,1,.3,1)] hover:w-[200px] focus-within:w-[200px]"
      aria-label={allLabel}
    >
      {item("all", allLabel, allCount, null, null, true)}
      {vendors.map((vendor) => {
        const { name, mono, color } = vendorById(vendor.id);
        return item(vendor.id, vendor.name || name, vendor.count, mono, color);
      })}
    </div>
  );
}
