import { HostRoom } from "@/components/host-room";
export default async function HostRoomPage({ params }: { params: Promise<{ code: string }> }) { return <HostRoom code={(await params).code}/>; }
