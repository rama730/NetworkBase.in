import { normalizeApplicationLine } from "@/lib/messaging/application-status";
import { joinPeople } from "@/lib/messaging/mix-format";

/**
 * What a system row says. Stored bodies follow the actor's name ("joined #design"); a body that is
 * already a whole sentence ("Acme School assigned …") is shown without the actor in front.
 * `<@id>` tokens become names ("added Ana Ruiz, Ben Okafor"); a grouped line names two people,
 * then "and N others", and its tooltip stops at 20 names.
 */
export function systemLine(body: string, people: string[], nameOf: (id: string) => string | null | undefined) {
  const text = normalizeApplicationLine(body).replace(/<@([^>\s]+)>/g, (_, id: string) => nameOf(id) ?? "someone");
  const sentence = /^[A-Z0-9“"]/.test(text);
  const who = sentence ? null : people.length === 2 ? `${people[0]} and ${people[1]}` : joinPeople(people, 1);
  return { who, text, title: people.length > 2 ? joinPeople(people, 20) : undefined };
}

/** The long-message fold's button: "Show all · 4,000 characters". */
export function foldLabel(length: number) {
  return `Show all · ${new Intl.NumberFormat("en-US").format(length)} characters`;
}
