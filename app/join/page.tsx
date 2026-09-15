import { Suspense } from "react";
import { JoinFlow } from "@/components/join-flow";
export const metadata = { title: "Join a quiz" };
export default function JoinPage() { return <Suspense><JoinFlow/></Suspense>; }
