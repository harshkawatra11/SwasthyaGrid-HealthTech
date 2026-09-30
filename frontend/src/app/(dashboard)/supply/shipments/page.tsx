import { redirect } from "next/navigation";

// The shipments list page has been retired: Dispatch (`/supply`) now shows
// the live orders list. Old links to the bare list route still resolve.
export default function Page() {
  redirect("/supply");
}
