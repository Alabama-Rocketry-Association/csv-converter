import ARA from '/ARA.jpeg';
import React, { useState } from 'react';

const Navbar: React.FC<any> = (props) => {
  const { data = [], onSelect } = props;
  const folders = data.reduce((acc: Record<string, any[]>, item: any) => {
    if (!acc[item.folder]) acc[item.folder] = [];
    acc[item.folder].push(item);
    return acc;
  }, {});

  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  const toggleFolder = (folder: string) => {
    setOpenFolders((prev) => ({
      ...prev,
      [folder]: !prev[folder],
    }));
  };
  return (
    <div className="navbar bg-base-100">
      <div className="flex-1">
        <a href="https://www.alabamarocketry.org/" className="btn btn-ghost text-xl">Alabama Rocketry Association</a>
      </div>
      <div className="flex-none gap-2">
        <div className="dropdown dropdown-end">
          <div tabIndex={0} role="button" className="btn btn-ghost btn-circle avatar">
            <div className="w-10 rounded-full">
              <img
                alt="image"
                src={ARA} />
            </div>
          </div>

          <ul
            tabIndex={0}
            className="menu menu-sm dropdown-content rounded-box z-[1] mt-3 w-52 p-2 shadow bg-blue-500">
            <h1 className="text-center font-bold text-black">CSVs in Repo</h1>
            {data.length === 0 && (
              <li>
                <a className="text-black">CSVs Loading...</a>
              </li>
            )}
 <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
      {Object.keys(folders).map((folder, index) => (
        <li key={index}>
          <button
            onClick={() => toggleFolder(folder)}
            style={{
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              fontWeight: 'bold',
              fontSize: '1rem',
              marginBottom: '0.5rem',
            }}
          >
            {openFolders[folder] ? '∨' : '∧'} {folder}
          </button>
          {openFolders[folder] && (
            <ul style={{ paddingLeft: '20px' }}>
              {folders[folder].map((file: { url: any; name: string | number | boolean | React.ReactElement<any, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | React.ReactPortal | null | undefined; }, fileIndex: React.Key | null | undefined) => (
                <li key={fileIndex} onClick={() => onSelect && onSelect(file.url)}>
                  <a href="#" style={{ cursor: 'pointer', textDecoration: 'underline' }}>
                    {file.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Navbar;