import "../styles/globals.css";
import type { AppProps } from "next/app";
import { createGlobalStyle } from "styled-components";

import { AuthContextProvider } from "../contexts/AuthContext";
import { ClientContextProvider } from "../contexts/ClientContext";
import { JsonRpcContextProvider } from "../contexts/JsonRpcContext";
import { ChainDataContextProvider } from "../contexts/ChainDataContext";
import Metadata from "../components/Metadata";

import { globalStyle } from "../styles";
const GlobalStyle = createGlobalStyle`
  ${globalStyle}
`;

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Metadata />
      <GlobalStyle />
      <ChainDataContextProvider>
        <ClientContextProvider>
          <AuthContextProvider>
            <JsonRpcContextProvider>
              <Component {...pageProps} />
            </JsonRpcContextProvider>
          </AuthContextProvider>
        </ClientContextProvider>
      </ChainDataContextProvider>
    </>
  );
}

export default MyApp;
