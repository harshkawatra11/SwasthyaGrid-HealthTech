import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TruckCargoView, type CargoSlot } from "./TruckCargoView";

afterEach(cleanup);

const slots: CargoSlot[] = [
  { index: 0, state: "loaded", medicine_name: "Anti-Rabies Vaccine (ARV)", cold_chain: true },
  { index: 1, state: "reserved", cold_chain: false },
  { index: 2, state: "empty", cold_chain: false },
  { index: 3, state: "empty", cold_chain: false },
  { index: 4, state: "empty", cold_chain: false },
  { index: 5, state: "empty", cold_chain: false },
];

describe("TruckCargoView", () => {
  it("draws one cell per pallet slot with an accessible summary", () => {
    const { container, getByRole } = render(<TruckCargoView vehicleClass="reefer_truck" slots={slots} coldChain />);
    expect(getByRole("img").getAttribute("aria-label")).toContain("1 loaded, 1 reserved, 4 empty of 6 pallet slots");
    expect(container.querySelectorAll("g > title")).toHaveLength(6);
    expect(container.textContent).toContain("ARV");
  });

  it("stays a 640 by 220 viewBox for every class", () => {
    for (const c of ["van", "light_truck", "reefer_van", "medium_truck", "reefer_truck"]) {
      const { container } = render(<TruckCargoView vehicleClass={c} slots={slots.slice(0, 2)} coldChain={false} compact />);
      expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 640 220");
      cleanup();
    }
  });
});
