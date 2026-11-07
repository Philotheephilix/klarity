'use client';

import Link from 'next/link';
import { Card } from '../../components/Card';
import { AddDescriptorForm } from '../../components/AddDescriptorForm';

export default function AddDescriptorPage() {
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Add descriptor</span>
      </nav>
      <div className="page-head">
        <h1 className="page-title page-title-xl">Add a descriptor</h1>
        <p className="page-sub">
          Author a clear-signing descriptor and submit it with your wallet. The
          write is signed in-browser and, once authorized, mirrored to the
          registry with a pull request opened automatically.
        </p>
      </div>
      <div className="add-page">
        <Card>
          <div className="card-pad">
            <AddDescriptorForm />
          </div>
        </Card>
      </div>
    </>
  );
}
