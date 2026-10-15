export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm leading-7">
      <h1 className="font-[family-name:var(--font-display)] text-4xl">Privacy</h1>
      <p className="mt-6">
        Talk2Build keeps the live meeting in memory on the server that is running the demo. Utterances, decisions,
        and the draft pull request are not written to a database. Microphone audio is transcribed by the browser
        Web Speech API and is not uploaded as audio. Reset clears the room.
      </p>
      <p className="mt-4">
        If you connect the MCP server to Alexa+, Amazon receives the tool calls Alexa+ makes, under your Alexa+
        add-on configuration. Model calls go to Amazon Bedrock or to the OpenAI-compatible endpoint you configure.
        Mock mode sends nothing.
      </p>
    </main>
  );
}
