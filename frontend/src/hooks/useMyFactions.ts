import { useQuery } from "@tanstack/react-query";
import { request } from "../lib/api";
import type { MyFactions } from "../types/factions";
import { useSession } from "./useSession";

export function useMyFactions() {
  const session = useSession();
  return useQuery({
    queryKey: ["my-factions"],
    queryFn: () => request<MyFactions>("/factions/mine/"),
    enabled: session.data?.authenticated === true,
    staleTime: 10_000,
  });
}

/** True when the signed-in user leads or belongs to a faction, or has a registration awaiting review. */
export function useHasFaction() {
  const mine = useMyFactions();
  const data = mine.data;
  return Boolean(
    data &&
      (data.owned.length > 0 || data.membership || data.pending_registration),
  );
}
