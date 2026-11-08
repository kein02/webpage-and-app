import GeneratorPanel from '../components/GeneratorPanel'
import PageShell from '../components/PageShell'
export default function AiImage() {
  return (
    <PageShell title="AI 图片" subtitle="从文字出发，创造属于你的画面。">
      <GeneratorPanel kind="image" />
    </PageShell>
  )
}
