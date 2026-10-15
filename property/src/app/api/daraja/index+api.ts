export async function POST(request: Request) {
  try {
    const bodyText = await request.text();
    console.log('====================');
    console.log('DARAJA WEBHOOK BODY');
    console.log(bodyText);

    const payload = JSON.parse(bodyText);
    const supabaseUrl =
      process.env.VITE_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      process.env.EXPO_PUBLIC_SUPABASE_URL;

    if (supabaseUrl) {
      const incomingUrl = new URL(request.url);
      const search = incomingUrl.search;
      const callbackUrl = `${supabaseUrl}/functions/v1/payments/callback${search}`;
      console.log(`\n🚀 Forwarding to Supabase callback at: ${callbackUrl}`);
      try {
        const cbResponse = await fetch(callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        console.log(
          `✅ Supabase Callback Response: ${cbResponse.status} ${cbResponse.statusText}`,
        );
      } catch (cbErr: any) {
        console.error('❌ Error forwarding to Supabase callback:', cbErr.message);
      }
    } else {
      console.warn('⚠️ SUPABASE_URL is not set, skipping forward to Supabase callback.');
    }

    console.log('====================');
    return Response.json(
      {
        ResultCode: 0,
        ResultDesc: 'Success',
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error('Error processing Daraja webhook:', err.message);
    console.log('====================');
    return Response.json(
      {
        ResultCode: 0,
        ResultDesc: 'Success',
      },
      { status: 200 },
    );
  }
}
