'use client';

import Link from 'next/link';
import { Card } from '../../components/Card';
import { AddDescriptorForm } from '../../components/AddDescriptorForm';

export default function AddDescriptorPage() {
  return (
    <>
      <div className="crumbs">
        <Link href="/">Home</Link>
        <span>/</span>
        <span>Add descriptor</span>
      </div>
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
