import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface CSVFile { folder: string; name: string; url: string; }
interface Props { data?: CSVFile[]; loading?: boolean; busy?: boolean; onSelect?: (url: string) => void; }

export default function Navbar({ data = [], loading = false, busy = false, onSelect }: Props) {
  const folders = data.reduce<Record<string, CSVFile[]>>((groups, file) => {
    (groups[file.folder] ??= []).push(file);
    return groups;
  }, {});

  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b bg-background px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <img src={`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}ARA.jpeg`} alt="" className="size-8 shrink-0 rounded-sm object-contain" />
        <span className="truncate text-sm font-semibold">ARA CSV converter</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy}>Sample files</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[70vh] w-72 overflow-y-auto">
          <DropdownMenuLabel>Sample files</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {data.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">{loading ? "Loading..." : "No sample files available."}</div>}
          {Object.entries(folders).map(([folder, files]) => (
            <Fragment key={folder}>
              <DropdownMenuLabel className="text-xs text-muted-foreground">{folder}</DropdownMenuLabel>
              {files.map(file => <DropdownMenuItem key={file.url} className="whitespace-normal break-all" onSelect={() => onSelect?.(file.url)}>{file.name}</DropdownMenuItem>)}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
