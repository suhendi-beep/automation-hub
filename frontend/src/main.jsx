import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { installFetchAuth } from "./api.js";

installFetchAuth();

ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
