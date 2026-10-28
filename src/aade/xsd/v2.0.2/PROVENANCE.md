# myDATA XSD files, version 2.0.2

These are the official AADE myDATA XSD schema files for the REST API, version
2.0.2 (the version served by the myDATA **test / sandbox** environment, which is
the only environment this application targets until phase δ).

## Where they came from

The AADE site (`aade.gr`) is unreachable from the build environment: its Akamai
edge answers every request from here with HTTP 403, and the Wayback Machine copy
is blocked by the egress proxy as well. The files here were therefore taken from
the public **`firebed/aade-mydata`** repository
(`https://github.com/firebed/aade-mydata`, directory `xsd/`), a mature,
actively maintained mirror of the official AADE XSD files, at its v2.0.2 set.

Files copied (unmodified):

- `InvoicesDoc-v2.0.2.xsd` — invoice document (root `InvoicesDoc`)
- `SimpleTypes-v2.0.2.xsd` — shared enumerations and simple types
- `TransportTypes-v2.0.2.xsd` — transport/delivery types (included by InvoicesDoc)
- `incomeClassification-v2.0.2.xsd` — income classification types
- `expensesClassification-v2.0.2.xsd` — expenses classification types
- `response-v2.0.2.xsd` — `ResponseDoc` returned by SendInvoices / CancelInvoice

Namespaces are the official ones
(`http://www.aade.gr/myDATA/invoice/v1.0`, etc.).

## Verification still required

Because these did not come straight from `aade.gr`, they must be diffed against
the files downloaded directly from the official site before the application is
trusted in production. This is why `src/aade/spec.ts` keeps `verified: false`,
which keeps the `spec_verified` issuance check failing and every issuance
blocked. After the diff and an accountant's review, set `verified: true`.

To refresh directly from the source once `aade.gr` is reachable:
the files are linked from the "Τεχνική Περιγραφή Διεπαφών myDATA REST API" page
on aade.gr.
