import "../styles/globals.css";
import type { AppProps } from "next/app";
import { createGlobalStyle } from "styled-components";

import { SharedCoreContextProvider } from "../contexts/SharedCoreContext";
import { AuthContextProvider } from "../contexts/AuthContext";
import { ClientContextProvider } from "../contexts/ClientContext";
import { JsonRpcContextProvider } from "../contexts/JsonRpcContext";
import { ChainDataContextProvider } from "../contexts/ChainDataContext";
import Metadata from "../components/Metadata";

import { globalStyle } from "../styles";
import { SharedCoreContext } from "../contexts/SharedCoreContext";
const GlobalStyle = createGlobalStyle`
  ${globalStyle}
`;

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Metadata />
      <GlobalStyle />
      <ChainDataContextProvider>
        <SharedCoreContextProvider>
          <ClientContextProvider>
            <AuthContextProvider>
              <JsonRpcContextProvider>
                <Component {...pageProps} />
              </JsonRpcContextProvider>
            </AuthContextProvider>
          </ClientContextProvider>
        </SharedCoreContextProvider>
      </ChainDataContextProvider>
    </>
  );
}

export default MyApp;
