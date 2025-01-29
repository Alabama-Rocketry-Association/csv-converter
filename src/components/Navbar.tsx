import ARA from '/ARA.jpeg';

interface NavbarProps {
  data: {
    name: string;
    url: string;
  }[];
  onSelect?: (name: string) => void;
}
const Navbar: React.FC<NavbarProps> = ({ data = [], onSelect }) => {
return(
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
        {data.map((item, index) => (
          <li key={index} onClick={() => onSelect && onSelect(item.url)}>
        <a>{item.name}</a>
          </li>
        ))}
      </ul>
    </div>
  </div>
</div>
);
}

export default Navbar;