'use client';

import Link from 'next/link';
import { Card } from '../../components/Card';

export default function DecodeInfoPage() {
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Decode</span>
      </nav>
      <div className="page-head">
        <h1 className="page-title page-title-xl">Decode</h1>
        <p className="page-sub">
          The explorer contrasts a raw sample payload with its clear-signed view
          for any mirrored call.
        </p>
      </div>
      <div className="card-grid">
        <Card>
          <div className="card-pad">
            <div className="card-title">How to reach a decode</div>
            <p className="card-note">
              Pick a company, then a contract, then a call. The call page sends a
              sample payload to the Klarity API and renders the response beside
              the raw bytes.
            </p>
            <Link href="/browse">Browse companies</Link>
          </div>
        </Card>
      </div>
    </>
  );
}
