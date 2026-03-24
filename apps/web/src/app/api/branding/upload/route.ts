import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { validateBrandingFile } from '@/lib/customization/validate-branding-file';

/**
 * POST /api/branding/upload
 * Accepts a multipart/form-data upload with a single "file" field.
 * Validates type, extension, size, and content safety before accepting.
 *
 * On success returns { url } — currently a placeholder; wire to your storage
 * provider (e.g. Supabase Storage) in a follow-up.
 */
export const POST = withAuth(async (req: NextRequest) => {
    let formData: FormData;
    try {
        formData = await req.formData();
    } catch {
        return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
        return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 });
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const result = validateBrandingFile(file.name, file.type, file.size, buffer);

    if (!result.valid) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: 422 });
    }

    // TODO: upload buffer to Supabase Storage / S3 and return the real URL
    return NextResponse.json({ url: null, message: 'File validated successfully. Storage not yet wired.' }, { status: 200 });
});
