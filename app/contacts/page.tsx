import { ContactStatus } from "@prisma/client";
import { listContacts, listDistinctContactValues } from "@/lib/contacts";
import ContactsClient from "./contacts-client";

export const dynamic = "force-dynamic";

function normalizeStatus(value: string | undefined): ContactStatus | undefined {
  if (!value) {
    return undefined;
  }

  const upper = value.toUpperCase();
  return Object.values(ContactStatus).includes(upper as ContactStatus) ? (upper as ContactStatus) : undefined;
}

type PageProps = {
  searchParams: {
    status?: string;
    tag?: string;
    timezone?: string;
  };
};

export default async function ContactsPage({ searchParams }: PageProps) {
  const status = normalizeStatus(searchParams.status);
  const tag = searchParams.tag ? decodeURIComponent(searchParams.tag) : undefined;
  const timezone = searchParams.timezone ? decodeURIComponent(searchParams.timezone) : undefined;

  const [contacts, distinct] = await Promise.all([
    listContacts({ status: status ?? null, tag: tag ?? null, timezone: timezone ?? null }),
    listDistinctContactValues({ status: status ?? null, tag: null, timezone: null })
  ]);

  return (
    <ContactsClient
      contacts={contacts}
      statusOptions={Object.values(ContactStatus)}
      filter={{ status: status ?? null, tag: tag ?? null, timezone: timezone ?? null }}
      distinct={distinct}
    />
  );
}
